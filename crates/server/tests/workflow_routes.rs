use std::sync::Mutex;

use db::models::workflow::{NodeExecutionStatus, WorkflowRunStatus, WorkflowSource};
use serde_json::{Value, json};
use server::{
    error::ApiError,
    routes::workflows::{
        CreateWorkflowRequest, TriggerWorkflowRequest, UpdateWorkflowRequest,
        WorkflowActionResponse, WorkflowNodeExecutionResponse, WorkflowRunResponse,
        WorkflowTemplateListResponse, WorkflowTemplateResponse, create_project_workflow,
        delete_workflow_template, fallback_node_executions_payload, fallback_workflow_runs_payload,
        fallback_workflows_payload, list_project_workflows, update_workflow_template,
    },
    workflow_runtime::runner::{
        AgentNodeExecution, AgentNodeRequest, WorkflowAgentExecutor, WorkflowRunCanceller,
        WorkflowWorkspaceRequest, WorkflowWorkspaceResolver, approve_human_node,
        cancel_workflow_run_runtime, recover_stale_workflow_runs, reject_human_node,
        retry_workflow_node, trigger_workflow_run, workflow_event_history,
    },
};
use sqlx::{SqlitePool, sqlite::SqlitePoolOptions};
use ts_rs::TS;
use uuid::Uuid;

async fn setup_workflow_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .expect("connect in-memory sqlite");

    for statement in [
        r#"
        CREATE TABLE projects (
            id BLOB PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
        )
        "#,
        r#"
        CREATE TABLE workflows (
            id          BLOB PRIMARY KEY,
            source      TEXT NOT NULL CHECK (source IN ('system','project')),
            project_id  BLOB,
            name        TEXT NOT NULL,
            description TEXT,
            graph_json  TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
            CHECK (
                (source = 'system' AND project_id IS NULL) OR
                (source = 'project' AND project_id IS NOT NULL)
            )
        )
        "#,
        r#"
        CREATE TABLE workflow_runs (
            id             BLOB PRIMARY KEY,
            workflow_id    BLOB NOT NULL,
            issue_id       BLOB NOT NULL,
            workspace_id   BLOB,
            trigger_source TEXT NOT NULL DEFAULT 'manual',
            input_text     TEXT NOT NULL,
            output_text    TEXT,
            status         TEXT NOT NULL DEFAULT 'pending',
            started_at     TEXT,
            finished_at    TEXT,
            error_text     TEXT,
            created_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
        )
        "#,
        r#"
        CREATE TABLE node_executions (
            id             BLOB PRIMARY KEY,
            run_id         BLOB NOT NULL,
            node_id        TEXT NOT NULL,
            node_type      TEXT NOT NULL,
            iteration      INTEGER NOT NULL DEFAULT 0,
            status         TEXT NOT NULL DEFAULT 'pending',
            input_text     TEXT,
            output_text    TEXT,
            session_id     BLOB,
            arena_group_id BLOB,
            tokens_used    INTEGER,
            cost_estimate  REAL,
            started_at     TEXT,
            finished_at    TEXT,
            error_text     TEXT,
            created_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
            UNIQUE (run_id, node_id, iteration)
        )
        "#,
    ] {
        sqlx::query(statement)
            .execute(&pool)
            .await
            .expect("create workflow test schema");
    }

    pool
}

async fn insert_project(pool: &SqlitePool, project_id: Uuid) {
    sqlx::query("INSERT INTO projects (id, name) VALUES (?, ?)")
        .bind(project_id)
        .bind("Workflow Project")
        .execute(pool)
        .await
        .expect("insert project");
}

async fn insert_project_workflow(pool: &SqlitePool, project_id: Uuid) -> Uuid {
    let workflow_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Project Flow', 'project template', ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(valid_graph_json())
    .execute(pool)
    .await
    .expect("insert project workflow");
    workflow_id
}

fn valid_graph_json() -> String {
    json!({
        "version": 1,
        "nodes": [
            { "id": "start", "type": "start", "data": { "display_name": "Start" } },
            { "id": "end", "type": "end", "data": { "display_name": "End" } }
        ],
        "edges": [
            { "id": "e1", "source": "start", "target": "end", "type": "default" }
        ]
    })
    .to_string()
}

fn agent_graph_json() -> String {
    json!({
        "version": 1,
        "nodes": [
            { "id": "start", "type": "start", "data": { "display_name": "Start" } },
            {
                "id": "agent",
                "type": "agent",
                "data": {
                    "display_name": "Implementer",
                    "prompt_template": "Implement this: {{upstream}}"
                }
            },
            { "id": "end", "type": "end", "data": { "display_name": "End" } }
        ],
        "edges": [
            { "id": "e1", "source": "start", "target": "agent", "type": "default" },
            { "id": "e2", "source": "agent", "target": "end", "type": "default" }
        ]
    })
    .to_string()
}

fn human_gate_graph_json() -> String {
    json!({
        "version": 1,
        "nodes": [
            { "id": "start", "type": "start", "data": { "display_name": "Start" } },
            {
                "id": "gate",
                "type": "human_gate",
                "data": {
                    "display_name": "Approve plan",
                    "prompt_to_human": "Approve this plan?",
                    "required_action": "approve_or_reject"
                }
            },
            {
                "id": "agent",
                "type": "agent",
                "data": {
                    "display_name": "Implementer",
                    "prompt_template": "After approval: {{upstream}}"
                }
            },
            { "id": "end", "type": "end", "data": { "display_name": "End" } }
        ],
        "edges": [
            { "id": "e1", "source": "start", "target": "gate", "type": "default" },
            { "id": "e2", "source": "gate", "target": "agent", "type": "default" },
            { "id": "e3", "source": "agent", "target": "end", "type": "default" }
        ]
    })
    .to_string()
}

fn failing_transform_graph_json() -> String {
    json!({
        "version": 1,
        "nodes": [
            { "id": "start", "type": "start", "data": { "display_name": "Start" } },
            {
                "id": "transform",
                "type": "transform",
                "data": {
                    "display_name": "Extract ticket",
                    "mode": "regex_extract",
                    "regex": "NO_MATCH-(\\d+)"
                }
            },
            { "id": "end", "type": "end", "data": { "display_name": "End" } }
        ],
        "edges": [
            { "id": "e1", "source": "start", "target": "transform", "type": "default" },
            { "id": "e2", "source": "transform", "target": "end", "type": "default" }
        ]
    })
    .to_string()
}

fn fixed_transform_graph_json() -> String {
    json!({
        "version": 1,
        "nodes": [
            { "id": "start", "type": "start", "data": { "display_name": "Start" } },
            {
                "id": "transform",
                "type": "transform",
                "data": {
                    "display_name": "Summarize",
                    "mode": "template",
                    "template": "Fixed: {{input}}"
                }
            },
            { "id": "end", "type": "end", "data": { "display_name": "End" } }
        ],
        "edges": [
            { "id": "e1", "source": "start", "target": "transform", "type": "default" },
            { "id": "e2", "source": "transform", "target": "end", "type": "default" }
        ]
    })
    .to_string()
}

fn failing_condition_graph_json() -> String {
    json!({
        "version": 1,
        "nodes": [
            { "id": "start", "type": "start", "data": { "display_name": "Start" } },
            {
                "id": "condition",
                "type": "condition",
                "data": {
                    "display_name": "Broken condition",
                    "conditions": [
                        {
                            "input": "run_input",
                            "operator": "regex",
                            "value": "["
                        }
                    ]
                }
            },
            { "id": "end", "type": "end", "data": { "display_name": "End" } }
        ],
        "edges": [
            { "id": "e1", "source": "start", "target": "condition", "type": "default" },
            { "id": "e2", "source": "condition", "target": "end", "type": "default" }
        ]
    })
    .to_string()
}

fn fixed_condition_graph_json() -> String {
    json!({
        "version": 1,
        "nodes": [
            { "id": "start", "type": "start", "data": { "display_name": "Start" } },
            {
                "id": "condition",
                "type": "condition",
                "data": {
                    "display_name": "Fixed condition",
                    "conditions": [
                        {
                            "input": "run_input",
                            "operator": "contains",
                            "value": "LGTM"
                        }
                    ]
                }
            },
            { "id": "end", "type": "end", "data": { "display_name": "End" } }
        ],
        "edges": [
            { "id": "e1", "source": "start", "target": "condition", "type": "default" },
            { "id": "e2", "source": "condition", "target": "end", "type": "default" }
        ]
    })
    .to_string()
}

fn graph_without_start_json() -> String {
    json!({
        "version": 1,
        "nodes": [
            { "id": "agent", "type": "agent", "data": { "display_name": "Agent" } },
            { "id": "end", "type": "end", "data": { "display_name": "End" } }
        ],
        "edges": [
            { "id": "e1", "source": "agent", "target": "end", "type": "default" }
        ]
    })
    .to_string()
}

#[derive(Debug)]
struct FakeWorkspaceResolver {
    workspace_id: Uuid,
    requests: Mutex<Vec<WorkflowWorkspaceRequest>>,
}

impl FakeWorkspaceResolver {
    fn new(workspace_id: Uuid) -> Self {
        Self {
            workspace_id,
            requests: Mutex::new(Vec::new()),
        }
    }

    fn requests(&self) -> Vec<WorkflowWorkspaceRequest> {
        self.requests.lock().expect("workspace requests").clone()
    }
}

#[async_trait::async_trait]
impl WorkflowWorkspaceResolver for FakeWorkspaceResolver {
    async fn create_or_bind_main_workspace(
        &self,
        request: WorkflowWorkspaceRequest,
    ) -> Result<Uuid, ApiError> {
        self.requests
            .lock()
            .expect("workspace requests")
            .push(request.clone());

        Ok(request.existing_workspace_id.unwrap_or(self.workspace_id))
    }
}

#[derive(Debug)]
struct FakeAgentExecutor {
    session_id: Uuid,
    output_text: String,
    requests: Mutex<Vec<AgentNodeRequest>>,
}

impl FakeAgentExecutor {
    fn new(session_id: Uuid, output_text: impl Into<String>) -> Self {
        Self {
            session_id,
            output_text: output_text.into(),
            requests: Mutex::new(Vec::new()),
        }
    }

    fn requests(&self) -> Vec<AgentNodeRequest> {
        self.requests.lock().expect("agent requests").clone()
    }
}

#[async_trait::async_trait]
impl WorkflowAgentExecutor for FakeAgentExecutor {
    async fn run_agent(&self, request: AgentNodeRequest) -> Result<AgentNodeExecution, ApiError> {
        self.requests.lock().expect("agent requests").push(request);

        Ok(AgentNodeExecution::Completed {
            session_id: self.session_id,
            output_text: self.output_text.clone(),
        })
    }
}

#[derive(Debug)]
struct StartedAgentExecutor {
    session_id: Uuid,
    requests: Mutex<Vec<AgentNodeRequest>>,
}

impl StartedAgentExecutor {
    fn new(session_id: Uuid) -> Self {
        Self {
            session_id,
            requests: Mutex::new(Vec::new()),
        }
    }
}

#[async_trait::async_trait]
impl WorkflowAgentExecutor for StartedAgentExecutor {
    async fn run_agent(&self, request: AgentNodeRequest) -> Result<AgentNodeExecution, ApiError> {
        self.requests.lock().expect("agent requests").push(request);

        Ok(AgentNodeExecution::Started {
            session_id: self.session_id,
            output_text: Some("agent still running".to_string()),
        })
    }
}

#[derive(Debug)]
struct FailOnceAgentExecutor {
    session_id: Uuid,
    output_text: String,
    remaining_failures: Mutex<usize>,
    requests: Mutex<Vec<AgentNodeRequest>>,
}

impl FailOnceAgentExecutor {
    fn new(session_id: Uuid, output_text: impl Into<String>) -> Self {
        Self {
            session_id,
            output_text: output_text.into(),
            remaining_failures: Mutex::new(1),
            requests: Mutex::new(Vec::new()),
        }
    }

    fn requests(&self) -> Vec<AgentNodeRequest> {
        self.requests.lock().expect("agent requests").clone()
    }
}

#[async_trait::async_trait]
impl WorkflowAgentExecutor for FailOnceAgentExecutor {
    async fn run_agent(&self, request: AgentNodeRequest) -> Result<AgentNodeExecution, ApiError> {
        self.requests.lock().expect("agent requests").push(request);

        let mut remaining_failures = self.remaining_failures.lock().expect("remaining failures");
        if *remaining_failures > 0 {
            *remaining_failures -= 1;
            return Err(ApiError::BadRequest("agent failed once".to_string()));
        }

        Ok(AgentNodeExecution::Completed {
            session_id: self.session_id,
            output_text: self.output_text.clone(),
        })
    }
}

#[derive(Debug, Default)]
struct FakeRunCanceller {
    stopped_sessions: Mutex<Vec<Uuid>>,
}

impl FakeRunCanceller {
    fn stopped_sessions(&self) -> Vec<Uuid> {
        self.stopped_sessions
            .lock()
            .expect("stopped sessions")
            .clone()
    }
}

#[async_trait::async_trait]
impl WorkflowRunCanceller for FakeRunCanceller {
    async fn cancel_session(&self, session_id: Uuid) -> Result<(), ApiError> {
        self.stopped_sessions
            .lock()
            .expect("stopped sessions")
            .push(session_id);
        Ok(())
    }
}

#[test]
fn workflow_route_dtos_export_stable_type_names() {
    let declarations = [
        ("WorkflowTemplateResponse", WorkflowTemplateResponse::decl()),
        (
            "WorkflowTemplateListResponse",
            WorkflowTemplateListResponse::decl(),
        ),
        ("CreateWorkflowRequest", CreateWorkflowRequest::decl()),
        ("UpdateWorkflowRequest", UpdateWorkflowRequest::decl()),
        ("TriggerWorkflowRequest", TriggerWorkflowRequest::decl()),
        ("WorkflowRunResponse", WorkflowRunResponse::decl()),
        (
            "WorkflowNodeExecutionResponse",
            WorkflowNodeExecutionResponse::decl(),
        ),
        ("WorkflowActionResponse", WorkflowActionResponse::decl()),
    ];

    for (name, declaration) in declarations {
        assert!(
            declaration.contains(name),
            "{name} declaration should include its exported type name"
        );
    }
}

#[test]
fn workflow_router_function_is_public() {
    let _router = server::routes::workflows::router;
}

#[tokio::test]
async fn list_project_workflows_seeds_system_templates_and_returns_project_templates() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    let project_workflow_id = insert_project_workflow(&pool, project_id).await;

    let workflows = list_project_workflows(&pool, project_id)
        .await
        .expect("list workflows");

    let built_in_count = workflow::templates::built_in_templates().len();
    assert_eq!(workflows.len(), built_in_count + 1);
    assert!(
        workflows
            .iter()
            .any(|workflow| workflow.id == project_workflow_id
                && workflow.source == WorkflowSource::Project
                && workflow.project_id == Some(project_id))
    );
    assert_eq!(
        workflows
            .iter()
            .filter(|workflow| workflow.source == WorkflowSource::System
                && workflow.project_id.is_none())
            .count(),
        built_in_count
    );
}

#[tokio::test]
async fn create_project_workflow_rejects_invalid_graph() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    let result = create_project_workflow(
        &pool,
        project_id,
        CreateWorkflowRequest {
            name: "Invalid Flow".to_string(),
            description: None,
            graph_json: graph_without_start_json(),
        },
    )
    .await;

    assert!(
        matches!(result, Err(ApiError::BadRequest(message)) if message.contains("start")),
        "invalid graph should be rejected with a start-node validation error"
    );

    let project_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM workflows WHERE source = 'project'")
            .fetch_one(&pool)
            .await
            .expect("count project workflows");
    assert_eq!(project_count, 0);
}

#[tokio::test]
async fn update_system_template_returns_forbidden() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    let workflows = list_project_workflows(&pool, project_id)
        .await
        .expect("seed system workflows");
    let system_workflow_id = workflows
        .iter()
        .find(|workflow| workflow.source == WorkflowSource::System)
        .expect("system workflow")
        .id;

    let result = update_workflow_template(
        &pool,
        system_workflow_id,
        UpdateWorkflowRequest {
            name: Some("Changed".to_string()),
            description: None,
            graph_json: None,
        },
    )
    .await;

    assert!(
        matches!(result, Err(ApiError::Forbidden(message)) if message.contains("system")),
        "system workflows must not be editable"
    );
}

#[tokio::test]
async fn delete_system_template_returns_forbidden() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    let workflows = list_project_workflows(&pool, project_id)
        .await
        .expect("seed system workflows");
    let system_workflow_id = workflows
        .iter()
        .find(|workflow| workflow.source == WorkflowSource::System)
        .expect("system workflow")
        .id;

    let result = delete_workflow_template(&pool, system_workflow_id).await;

    assert!(
        matches!(result, Err(ApiError::Forbidden(message)) if message.contains("system")),
        "system workflows must not be deletable"
    );
}

#[tokio::test]
async fn fallback_payloads_return_workflow_table_keys() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let run_id = Uuid::new_v4();
    let node_execution_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Runnable Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(valid_graph_json())
    .execute(&pool)
    .await
    .expect("insert workflow");

    sqlx::query(
        r#"
        INSERT INTO workflow_runs
            (id, workflow_id, issue_id, workspace_id, trigger_source, input_text, status)
        VALUES (?, ?, ?, NULL, 'manual', 'Run it', 'pending')
        "#,
    )
    .bind(run_id)
    .bind(workflow_id)
    .bind(issue_id)
    .execute(&pool)
    .await
    .expect("insert workflow run");

    sqlx::query(
        r#"
        INSERT INTO node_executions
            (id, run_id, node_id, node_type, iteration, status, input_text)
        VALUES (?, ?, 'start', 'start', 0, 'pending', 'Run it')
        "#,
    )
    .bind(node_execution_id)
    .bind(run_id)
    .execute(&pool)
    .await
    .expect("insert node execution");

    let workflows_payload = fallback_workflows_payload(&pool, Some(project_id))
        .await
        .expect("workflow fallback payload");
    let workflow_runs_payload = fallback_workflow_runs_payload(&pool, Some(issue_id), None)
        .await
        .expect("workflow run fallback payload");
    let node_executions_payload = fallback_node_executions_payload(&pool, Some(run_id))
        .await
        .expect("node execution fallback payload");

    assert_payload_array_key(&workflows_payload, "workflows");
    assert_payload_array_key(&workflow_runs_payload, "workflow_runs");
    assert_payload_array_key(&node_executions_payload, "node_executions");
}

#[tokio::test]
async fn workflow_runner_trigger_creates_run_workspace_and_node_executions() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Agent Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(agent_graph_json())
    .execute(&pool)
    .await
    .expect("insert agent workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(session_id, "agent final output");

    let run = trigger_workflow_run(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Build workflow runner".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("trigger workflow run");

    assert_eq!(run.workflow_id, workflow_id);
    assert_eq!(run.issue_id, issue_id);
    assert_eq!(run.workspace_id, Some(workspace_id));
    assert_eq!(run.nodes.len(), 3);
    assert_eq!(
        run.nodes
            .iter()
            .map(|node| node.node_id.as_str())
            .collect::<Vec<_>>(),
        vec!["start", "agent", "end"]
    );

    let workspace_requests = workspace.requests();
    assert_eq!(workspace_requests.len(), 1);
    assert_eq!(workspace_requests[0].existing_workspace_id, None);
    assert_eq!(workspace_requests[0].issue_id, issue_id);
    assert_eq!(workspace_requests[0].run_id, run.id);
    assert_eq!(
        workspace_requests[0].branch_name,
        format!("vk/{issue_id}-wf-{}", short_run_id(run.id))
    );

    let run_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workflow_runs")
        .fetch_one(&pool)
        .await
        .expect("count workflow runs");
    let node_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM node_executions")
        .fetch_one(&pool)
        .await
        .expect("count node executions");
    assert_eq!(run_count, 1);
    assert_eq!(node_count, 3);
}

#[tokio::test]
async fn workflow_runner_trigger_binds_existing_workspace() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let existing_workspace_id = Uuid::new_v4();
    let fallback_workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Agent Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(agent_graph_json())
    .execute(&pool)
    .await
    .expect("insert agent workflow");

    let workspace = FakeWorkspaceResolver::new(fallback_workspace_id);
    let agent = FakeAgentExecutor::new(session_id, "agent final output");

    let run = trigger_workflow_run(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: Some(existing_workspace_id),
            trigger_source: "manual".to_string(),
            input_text: "Use current worktree".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("trigger workflow run");

    assert_eq!(run.workspace_id, Some(existing_workspace_id));
    assert_eq!(workspace.requests().len(), 1);
    assert_eq!(
        workspace.requests()[0].existing_workspace_id,
        Some(existing_workspace_id)
    );
}

#[tokio::test]
async fn workflow_runner_agent_node_uses_main_workspace_and_stores_session_output() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Agent Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(agent_graph_json())
    .execute(&pool)
    .await
    .expect("insert agent workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(session_id, "implemented feature");

    let run = trigger_workflow_run(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Add workflow task orchestration".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("trigger workflow run");

    let agent_requests = agent.requests();
    assert_eq!(agent_requests.len(), 1);
    assert_eq!(agent_requests[0].run_id, run.id);
    assert_eq!(agent_requests[0].node_id, "agent");
    assert_eq!(agent_requests[0].workspace_id, workspace_id);
    assert_eq!(
        agent_requests[0].prompt,
        "Implement this: Add workflow task orchestration"
    );

    let agent_node = run
        .nodes
        .iter()
        .find(|node| node.node_id == "agent")
        .expect("agent node execution");
    assert_eq!(agent_node.session_id, Some(session_id));
    assert_eq!(
        agent_node.output_text.as_deref(),
        Some("implemented feature")
    );
    assert_eq!(run.output_text.as_deref(), Some("implemented feature"));
}

#[tokio::test]
async fn workflow_human_gate_sets_run_awaiting_human() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Human Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(human_gate_graph_json())
    .execute(&pool)
    .await
    .expect("insert human workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(session_id, "should not run yet");

    let run = trigger_workflow_run(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Build workflow approvals".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("trigger workflow run");

    assert_eq!(run.status, WorkflowRunStatus::AwaitingHuman);
    assert!(agent.requests().is_empty());
    assert_eq!(
        node_status(&run.nodes, "gate"),
        NodeExecutionStatus::AwaitingHuman
    );
    assert_eq!(
        node_status(&run.nodes, "agent"),
        NodeExecutionStatus::Pending
    );
}

#[tokio::test]
async fn workflow_human_approve_resumes_downstream_nodes() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Human Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(human_gate_graph_json())
    .execute(&pool)
    .await
    .expect("insert human workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(session_id, "approved implementation");

    let run = trigger_workflow_run(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Ship the plan".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("trigger workflow run");

    let resumed = approve_human_node(&pool, run.id, "gate", &agent)
        .await
        .expect("approve human gate");

    assert_eq!(resumed.status, WorkflowRunStatus::Succeeded);
    assert_eq!(
        node_status(&resumed.nodes, "gate"),
        NodeExecutionStatus::Succeeded
    );
    assert_eq!(
        node_status(&resumed.nodes, "agent"),
        NodeExecutionStatus::Succeeded
    );
    assert_eq!(agent.requests().len(), 1);
    assert_eq!(agent.requests()[0].prompt, "After approval: Ship the plan");
    assert_eq!(
        resumed.output_text.as_deref(),
        Some("approved implementation")
    );
}

#[tokio::test]
async fn workflow_human_reject_fails_run() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Human Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(human_gate_graph_json())
    .execute(&pool)
    .await
    .expect("insert human workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(session_id, "should not run");

    let run = trigger_workflow_run(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Review before coding".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("trigger workflow run");

    let rejected = reject_human_node(&pool, run.id, "gate")
        .await
        .expect("reject human gate");

    assert_eq!(rejected.status, WorkflowRunStatus::Failed);
    assert_eq!(
        node_status(&rejected.nodes, "gate"),
        NodeExecutionStatus::Failed
    );
    assert!(agent.requests().is_empty());
    assert!(
        rejected
            .error_text
            .as_deref()
            .is_some_and(|message| message.contains("rejected"))
    );
}

#[tokio::test]
async fn workflow_human_cancel_marks_run_canceled_and_stops_running_session() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Agent Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(agent_graph_json())
    .execute(&pool)
    .await
    .expect("insert agent workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = StartedAgentExecutor::new(session_id);

    let run = trigger_workflow_run(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Long-running task".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("trigger workflow run");
    assert_eq!(run.status, WorkflowRunStatus::Running);

    let canceller = FakeRunCanceller::default();
    let canceled = cancel_workflow_run_runtime(&pool, run.id, &canceller)
        .await
        .expect("cancel workflow run");

    assert_eq!(canceled.status, WorkflowRunStatus::Canceled);
    assert_eq!(canceller.stopped_sessions(), vec![session_id]);
    assert_eq!(
        node_status(&canceled.nodes, "agent"),
        NodeExecutionStatus::Failed
    );
}

#[tokio::test]
async fn workflow_human_retry_failed_agent_node_resumes_without_rerunning_start() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Agent Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(agent_graph_json())
    .execute(&pool)
    .await
    .expect("insert agent workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FailOnceAgentExecutor::new(session_id, "retry succeeded");

    let failed = trigger_workflow_run(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Retry just the agent".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("trigger workflow run");
    assert_eq!(failed.status, WorkflowRunStatus::Failed);
    assert_eq!(
        node_status(&failed.nodes, "start"),
        NodeExecutionStatus::Succeeded
    );
    assert_eq!(
        node_status(&failed.nodes, "agent"),
        NodeExecutionStatus::Failed
    );

    let retried = retry_workflow_node(&pool, failed.id, "agent", &agent)
        .await
        .expect("retry agent node");

    assert_eq!(retried.status, WorkflowRunStatus::Succeeded);
    assert_eq!(agent.requests().len(), 2);
    assert_eq!(
        node_status(&retried.nodes, "start"),
        NodeExecutionStatus::Succeeded
    );
    assert_eq!(
        node_status(&retried.nodes, "agent"),
        NodeExecutionStatus::Succeeded
    );
    assert_eq!(retried.output_text.as_deref(), Some("retry succeeded"));
}

#[tokio::test]
async fn workflow_human_retry_failed_transform_node_uses_updated_graph() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Transform Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(failing_transform_graph_json())
    .execute(&pool)
    .await
    .expect("insert transform workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(session_id, "unused");

    let failed = trigger_workflow_run(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "No ticket here".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("trigger workflow run");
    assert_eq!(failed.status, WorkflowRunStatus::Failed);
    assert_eq!(
        node_status(&failed.nodes, "transform"),
        NodeExecutionStatus::Failed
    );

    sqlx::query("UPDATE workflows SET graph_json = ? WHERE id = ?")
        .bind(fixed_transform_graph_json())
        .bind(workflow_id)
        .execute(&pool)
        .await
        .expect("fix transform workflow");

    let retried = retry_workflow_node(&pool, failed.id, "transform", &agent)
        .await
        .expect("retry transform node");

    assert_eq!(retried.status, WorkflowRunStatus::Succeeded);
    assert_eq!(
        retried.output_text.as_deref(),
        Some("Fixed: No ticket here")
    );
}

#[tokio::test]
async fn workflow_human_retry_failed_condition_node_uses_updated_graph() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Condition Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(failing_condition_graph_json())
    .execute(&pool)
    .await
    .expect("insert condition workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(session_id, "unused");

    let failed = trigger_workflow_run(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "LGTM".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("trigger workflow run");
    assert_eq!(failed.status, WorkflowRunStatus::Failed);
    assert_eq!(
        node_status(&failed.nodes, "condition"),
        NodeExecutionStatus::Failed
    );

    sqlx::query("UPDATE workflows SET graph_json = ? WHERE id = ?")
        .bind(fixed_condition_graph_json())
        .bind(workflow_id)
        .execute(&pool)
        .await
        .expect("fix condition workflow");

    let retried = retry_workflow_node(&pool, failed.id, "condition", &agent)
        .await
        .expect("retry condition node");

    assert_eq!(retried.status, WorkflowRunStatus::Succeeded);
    assert_eq!(
        node_status(&retried.nodes, "condition"),
        NodeExecutionStatus::Succeeded
    );
}

#[tokio::test]
async fn workflow_human_recovery_marks_stale_running_nodes_failed() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let run_id = Uuid::new_v4();
    let node_execution_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Agent Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(agent_graph_json())
    .execute(&pool)
    .await
    .expect("insert workflow");
    sqlx::query(
        r#"
        INSERT INTO workflow_runs
            (id, workflow_id, issue_id, workspace_id, trigger_source, input_text, status)
        VALUES (?, ?, ?, NULL, 'manual', 'Recover this', 'running')
        "#,
    )
    .bind(run_id)
    .bind(workflow_id)
    .bind(issue_id)
    .execute(&pool)
    .await
    .expect("insert run");
    sqlx::query(
        r#"
        INSERT INTO node_executions (id, run_id, node_id, node_type, iteration, status)
        VALUES (?, ?, 'agent', 'agent', 0, 'running')
        "#,
    )
    .bind(node_execution_id)
    .bind(run_id)
    .execute(&pool)
    .await
    .expect("insert stale node");

    let recovered = recover_stale_workflow_runs(&pool)
        .await
        .expect("recover stale workflow runs");
    let run = server::workflow_runtime::runner::get_workflow_run_response(&pool, run_id)
        .await
        .expect("get recovered run");

    assert_eq!(recovered, 1);
    assert_eq!(run.status, WorkflowRunStatus::Failed);
    assert_eq!(
        node_status(&run.nodes, "agent"),
        NodeExecutionStatus::Failed
    );
    assert!(
        run.error_text
            .as_deref()
            .is_some_and(|message| message.contains("recover"))
    );
}

#[tokio::test]
async fn workflow_events_records_run_and_node_status_changes() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Human Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(human_gate_graph_json())
    .execute(&pool)
    .await
    .expect("insert human workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(session_id, "approved implementation");
    let run = trigger_workflow_run(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Emit workflow events".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("trigger workflow run");

    approve_human_node(&pool, run.id, "gate", &agent)
        .await
        .expect("approve human gate");

    let events = workflow_event_history(run.id);
    assert!(
        events
            .iter()
            .any(|event| event.kind == workflow::WorkflowEventKind::RunStatus
                && event.status.as_deref() == Some("awaiting_human"))
    );
    assert!(events.iter().any(
        |event| event.kind == workflow::WorkflowEventKind::NodeWaitingHuman
            && event.node_id.as_deref() == Some("gate")
    ));
    assert!(events.iter().any(
        |event| event.kind == workflow::WorkflowEventKind::NodeStatus
            && event.node_id.as_deref() == Some("agent")
            && event.status.as_deref() == Some("succeeded")
    ));
    assert!(
        events
            .iter()
            .any(|event| event.kind == workflow::WorkflowEventKind::RunStatus
                && event.status.as_deref() == Some("succeeded"))
    );
}

fn short_run_id(run_id: Uuid) -> String {
    run_id.simple().to_string()[..8].to_string()
}

fn assert_payload_array_key(payload: &Value, key: &str) {
    assert!(
        payload.get(key).and_then(Value::as_array).is_some(),
        "fallback payload should include an array at `{key}`"
    );
}

fn node_status(nodes: &[WorkflowNodeExecutionResponse], node_id: &str) -> NodeExecutionStatus {
    nodes
        .iter()
        .find(|node| node.node_id == node_id)
        .unwrap_or_else(|| panic!("missing node execution `{node_id}`"))
        .status
}
