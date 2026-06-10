use std::sync::Mutex;

use db::models::{
    execution_process::ExecutionProcessStatus,
    scratch::DraftWorkspaceRepo,
    workflow::{NodeExecutionStatus, WorkflowAttemptStatus, WorkflowRunStatus, WorkflowSource},
};
use serde_json::{Value, json};
use server::{
    error::ApiError,
    routes::workflows::{
        CreateWorkflowAttemptRequest, CreateWorkflowRequest, RunWorkflowAttemptRequest,
        SelectArenaWinnerRequest, TriggerWorkflowRequest, UpdateWorkflowRequest,
        WorkflowActionResponse, WorkflowAttemptListResponse, WorkflowAttemptResponse,
        WorkflowNodeExecutionResponse, WorkflowRunResponse, WorkflowTemplateListResponse,
        WorkflowTemplateResponse, create_issue_workflow_attempt,
        create_issue_workflow_attempt_with_resources, create_project_workflow,
        delete_issue_workflow_attempt, delete_workflow_template, fallback_node_executions_payload,
        fallback_workflow_runs_payload, fallback_workflows_payload, list_project_workflows,
        run_workflow_attempt_runtime, sync_attempt_from_run, update_workflow_template,
        workflow_attempt_by_id, workflow_attempt_by_workflow_id,
    },
    workflow_runtime::{
        arena::{
            ArenaNodeExecution, ArenaNodeRequest, ArenaWinnerExecution, ArenaWinnerRequest,
            WorkflowArenaCreator, WorkflowArenaWinnerApplier,
        },
        runner::{
            AgentNodeExecution, AgentNodeRequest, WorkflowAgentExecutor, WorkflowRunCanceller,
            WorkflowWorkspaceRequest, WorkflowWorkspaceResolver, approve_human_node,
            cancel_workflow_run_runtime, reconcile_workflow_run, recover_stale_workflow_runs,
            reject_human_node, retry_workflow_node, select_arena_winner_with_arena,
            trigger_workflow_run, trigger_workflow_run_with_arena, workflow_event_history,
        },
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
        CREATE TABLE local_issues (
            id BLOB PRIMARY KEY,
            project_id BLOB NOT NULL,
            title TEXT NOT NULL,
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
            attempt_id     BLOB,
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
        CREATE TABLE workflow_attempts (
            id             BLOB PRIMARY KEY,
            project_id     BLOB NOT NULL,
            issue_id       BLOB NOT NULL,
            workflow_id    BLOB NOT NULL,
            latest_run_id  BLOB,
            workspace_id   BLOB,
            name           TEXT NOT NULL,
            status         TEXT NOT NULL DEFAULT 'draft',
            created_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
            updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
            UNIQUE (workflow_id)
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
            execution_process_id BLOB,
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
        r#"
        CREATE TABLE execution_processes (
            id BLOB PRIMARY KEY,
            session_id BLOB NOT NULL,
            run_reason TEXT NOT NULL,
            executor_action TEXT NOT NULL,
            status TEXT NOT NULL,
            exit_code INTEGER,
            dropped BOOLEAN NOT NULL DEFAULT FALSE,
            started_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
            completed_at TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
        )
        "#,
        r#"
        CREATE TABLE repos (
            id BLOB PRIMARY KEY,
            path TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            display_name TEXT NOT NULL,
            setup_script TEXT,
            cleanup_script TEXT,
            archive_script TEXT,
            copy_files TEXT,
            parallel_setup_script BOOLEAN NOT NULL DEFAULT FALSE,
            dev_server_script TEXT,
            default_target_branch TEXT,
            default_working_dir TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
        )
        "#,
        r#"
        CREATE TABLE workspace_repos (
            id BLOB PRIMARY KEY,
            workspace_id BLOB NOT NULL,
            repo_id BLOB NOT NULL,
            target_branch TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
        )
        "#,
        r#"
        CREATE TABLE sessions (
            id BLOB PRIMARY KEY,
            workspace_id BLOB NOT NULL,
            name TEXT,
            executor TEXT,
            agent_working_dir TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
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

async fn insert_local_issue(pool: &SqlitePool, project_id: Uuid, issue_id: Uuid, title: &str) {
    sqlx::query("INSERT INTO local_issues (id, project_id, title) VALUES (?, ?, ?)")
        .bind(issue_id)
        .bind(project_id)
        .bind(title)
        .execute(pool)
        .await
        .expect("insert local issue");
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

async fn insert_execution_process(
    pool: &SqlitePool,
    execution_process_id: Uuid,
    session_id: Uuid,
    status: ExecutionProcessStatus,
    exit_code: Option<i64>,
) {
    let completed_at = if matches!(status, ExecutionProcessStatus::Running) {
        None
    } else {
        Some("2026-05-17T00:00:00.000Z")
    };
    sqlx::query(
        r#"
        INSERT INTO execution_processes
            (id, session_id, run_reason, executor_action, status, exit_code, dropped, completed_at)
        VALUES (?, ?, 'codingagent', '{}', ?, ?, FALSE, ?)
        "#,
    )
    .bind(execution_process_id)
    .bind(session_id)
    .bind(match status {
        ExecutionProcessStatus::Running => "running",
        ExecutionProcessStatus::Completed => "completed",
        ExecutionProcessStatus::Failed => "failed",
        ExecutionProcessStatus::Killed => "killed",
    })
    .bind(exit_code)
    .bind(completed_at)
    .execute(pool)
    .await
    .expect("insert execution process");
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

fn two_agent_graph_json() -> String {
    json!({
        "version": 1,
        "nodes": [
            { "id": "start", "type": "start", "data": { "display_name": "Start" } },
            {
                "id": "agent-a",
                "type": "agent",
                "data": {
                    "display_name": "Agent A",
                    "prompt_template": "Agent A prompt"
                }
            },
            {
                "id": "agent-b",
                "type": "agent",
                "data": {
                    "display_name": "Agent B",
                    "prompt_template": "Agent B prompt"
                }
            },
            { "id": "end", "type": "end", "data": { "display_name": "End" } }
        ],
        "edges": [
            { "id": "e1", "source": "start", "target": "agent-a", "type": "default" },
            { "id": "e2", "source": "agent-a", "target": "agent-b", "type": "default" },
            { "id": "e3", "source": "agent-b", "target": "end", "type": "default" }
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

fn arena_graph_json() -> String {
    json!({
        "version": 1,
        "nodes": [
            { "id": "start", "type": "start", "data": { "display_name": "Start" } },
            {
                "id": "plan",
                "type": "transform",
                "data": {
                    "display_name": "Plan",
                    "mode": "template",
                    "template": "Plan: {{input}}"
                }
            },
            {
                "id": "arena",
                "type": "arena",
                "data": {
                    "display_name": "Arena implementation",
                    "prompt_template": "Implement candidates from {{upstream}}",
                    "attempts": [
                        { "id": "a", "display_name": "Candidate A" },
                        { "id": "b", "display_name": "Candidate B" },
                        { "id": "c", "display_name": "Candidate C" }
                    ],
                    "promote_strategy": "manual",
                    "apply_strategy": "diff_apply"
                }
            },
            { "id": "end", "type": "end", "data": { "display_name": "End" } }
        ],
        "edges": [
            { "id": "e1", "source": "start", "target": "plan", "type": "default" },
            { "id": "e2", "source": "plan", "target": "arena", "type": "default" },
            { "id": "e3", "source": "arena", "target": "end", "type": "arena_winner" }
        ]
    })
    .to_string()
}

fn fan_in_agent_graph_json() -> String {
    json!({
        "version": 2,
        "nodes": [
            { "id": "start", "type": "start", "data": { "display_name": "Start" } },
            {
                "id": "scan",
                "type": "transform",
                "data": {
                    "display_name": "Scan code",
                    "mode": "template",
                    "template": "Scan: {{input}}"
                }
            },
            {
                "id": "summarize",
                "type": "transform",
                "data": {
                    "display_name": "Summarize task",
                    "mode": "template",
                    "template": "Summary: {{input}}"
                }
            },
            {
                "id": "review",
                "type": "agent",
                "data": {
                    "display_name": "Review",
                    "prompt_template": "Review the current worktree."
                }
            },
            { "id": "end", "type": "end", "data": { "display_name": "End" } }
        ],
        "edges": [
            { "id": "e1", "source": "start", "target": "scan", "type": "default" },
            { "id": "e2", "source": "start", "target": "summarize", "type": "default" },
            { "id": "e3", "source": "scan", "target": "review", "type": "default" },
            { "id": "e4", "source": "summarize", "target": "review", "type": "default" },
            { "id": "e5", "source": "review", "target": "end", "type": "default" }
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
                    "display_name": "Condition router",
                    "routing_mode": "single",
                    "branches": [
                        {
                            "target_node_id": "end",
                            "condition": "Continue when the router selects this branch."
                        }
                    ]
                }
            },
            { "id": "end", "type": "end", "data": { "display_name": "End" } }
        ],
        "edges": [
            { "id": "e1", "source": "start", "target": "condition", "type": "default" },
            { "id": "e2", "source": "condition", "target": "end", "type": "condition_branch" }
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

fn unreachable_draft_graph_json() -> String {
    json!({
        "version": 2,
        "nodes": [
            { "id": "start", "type": "start", "data": { "display_name": "Start" } },
            { "id": "end", "type": "end", "data": { "display_name": "End" } },
            {
                "id": "agent-draft",
                "type": "agent",
                "data": {
                    "display_name": "Draft Agent",
                    "prompt_template": "Draft prompt"
                }
            }
        ],
        "edges": [
            {
                "id": "start-end",
                "source": "start",
                "source_handle": "output-right",
                "target": "end",
                "target_handle": "input-left",
                "type": "default"
            }
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
    execution_process_id: Uuid,
    output_text: String,
    requests: Mutex<Vec<AgentNodeRequest>>,
}

impl FakeAgentExecutor {
    fn new(session_id: Uuid, output_text: impl Into<String>) -> Self {
        Self::with_execution_process(session_id, Uuid::new_v4(), output_text)
    }

    fn with_execution_process(
        session_id: Uuid,
        execution_process_id: Uuid,
        output_text: impl Into<String>,
    ) -> Self {
        Self {
            session_id,
            execution_process_id,
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
            execution_process_id: self.execution_process_id,
            output_text: self.output_text.clone(),
        })
    }
}

#[derive(Debug)]
struct StartedAgentExecutor {
    session_id: Uuid,
    execution_process_id: Uuid,
    requests: Mutex<Vec<AgentNodeRequest>>,
}

impl StartedAgentExecutor {
    fn new(session_id: Uuid) -> Self {
        Self {
            session_id,
            execution_process_id: Uuid::new_v4(),
            requests: Mutex::new(Vec::new()),
        }
    }

    fn execution_process_id(&self) -> Uuid {
        self.execution_process_id
    }
}

#[async_trait::async_trait]
impl WorkflowAgentExecutor for StartedAgentExecutor {
    async fn run_agent(&self, request: AgentNodeRequest) -> Result<AgentNodeExecution, ApiError> {
        self.requests.lock().expect("agent requests").push(request);

        Ok(AgentNodeExecution::Started {
            session_id: self.session_id,
            execution_process_id: self.execution_process_id,
            output_text: Some("agent still running".to_string()),
        })
    }
}

#[derive(Debug)]
struct AsyncThenCompleteAgentExecutor {
    first_session_id: Uuid,
    first_execution_process_id: Uuid,
    second_session_id: Uuid,
    second_execution_process_id: Uuid,
    requests: Mutex<Vec<AgentNodeRequest>>,
}

impl AsyncThenCompleteAgentExecutor {
    fn new(
        first_session_id: Uuid,
        first_execution_process_id: Uuid,
        second_session_id: Uuid,
        second_execution_process_id: Uuid,
    ) -> Self {
        Self {
            first_session_id,
            first_execution_process_id,
            second_session_id,
            second_execution_process_id,
            requests: Mutex::new(Vec::new()),
        }
    }

    fn requests(&self) -> Vec<AgentNodeRequest> {
        self.requests.lock().expect("agent requests").clone()
    }
}

#[async_trait::async_trait]
impl WorkflowAgentExecutor for AsyncThenCompleteAgentExecutor {
    async fn run_agent(&self, request: AgentNodeRequest) -> Result<AgentNodeExecution, ApiError> {
        let node_id = request.node_id.clone();
        self.requests.lock().expect("agent requests").push(request);

        if node_id == "agent-a" {
            return Ok(AgentNodeExecution::Started {
                session_id: self.first_session_id,
                execution_process_id: self.first_execution_process_id,
                output_text: Some("agent A started".to_string()),
            });
        }

        Ok(AgentNodeExecution::Completed {
            session_id: self.second_session_id,
            execution_process_id: self.second_execution_process_id,
            output_text: "agent B done".to_string(),
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
            execution_process_id: Uuid::new_v4(),
            output_text: self.output_text.clone(),
        })
    }
}

#[derive(Debug)]
struct FakeArenaCreator {
    group_id: Uuid,
    requests: Mutex<Vec<ArenaNodeRequest>>,
}

impl FakeArenaCreator {
    fn new(group_id: Uuid) -> Self {
        Self {
            group_id,
            requests: Mutex::new(Vec::new()),
        }
    }

    fn requests(&self) -> Vec<ArenaNodeRequest> {
        self.requests.lock().expect("arena requests").clone()
    }
}

#[async_trait::async_trait]
impl WorkflowArenaCreator for FakeArenaCreator {
    async fn create_arena(
        &self,
        request: ArenaNodeRequest,
    ) -> Result<ArenaNodeExecution, ApiError> {
        self.requests.lock().expect("arena requests").push(request);

        Ok(ArenaNodeExecution {
            arena_group_id: self.group_id,
        })
    }
}

#[derive(Debug)]
struct FakeArenaWinnerApplier {
    result: Mutex<Result<String, String>>,
    requests: Mutex<Vec<ArenaWinnerRequest>>,
}

impl FakeArenaWinnerApplier {
    fn succeeds(output_text: impl Into<String>) -> Self {
        Self {
            result: Mutex::new(Ok(output_text.into())),
            requests: Mutex::new(Vec::new()),
        }
    }

    fn fails(message: impl Into<String>) -> Self {
        Self {
            result: Mutex::new(Err(message.into())),
            requests: Mutex::new(Vec::new()),
        }
    }

    fn requests(&self) -> Vec<ArenaWinnerRequest> {
        self.requests.lock().expect("winner requests").clone()
    }
}

#[async_trait::async_trait]
impl WorkflowArenaWinnerApplier for FakeArenaWinnerApplier {
    async fn apply_winner(
        &self,
        request: ArenaWinnerRequest,
    ) -> Result<ArenaWinnerExecution, ApiError> {
        self.requests.lock().expect("winner requests").push(request);

        match self.result.lock().expect("winner result").clone() {
            Ok(output_text) => Ok(ArenaWinnerExecution { output_text }),
            Err(message) => Err(ApiError::BadRequest(message)),
        }
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
        (
            "CreateWorkflowAttemptRequest",
            CreateWorkflowAttemptRequest::decl(),
        ),
        (
            "RunWorkflowAttemptRequest",
            RunWorkflowAttemptRequest::decl(),
        ),
        ("SelectArenaWinnerRequest", SelectArenaWinnerRequest::decl()),
        ("WorkflowAttemptResponse", WorkflowAttemptResponse::decl()),
        (
            "WorkflowAttemptListResponse",
            WorkflowAttemptListResponse::decl(),
        ),
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
async fn create_workflow_attempt_creates_issue_bound_draft() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_local_issue(&pool, project_id, issue_id, "Build attempt model").await;

    let attempt = create_issue_workflow_attempt(
        &pool,
        project_id,
        issue_id,
        CreateWorkflowAttemptRequest {
            name: Some("Workflow attempt".to_string()),
            graph_json: valid_graph_json(),
            repos: None,
        },
    )
    .await
    .expect("create workflow attempt");

    assert_eq!(attempt.project_id, project_id);
    assert_eq!(attempt.issue_id, issue_id);
    assert_eq!(attempt.status, WorkflowAttemptStatus::Draft);
    assert!(attempt.latest_run_id.is_none());
    assert!(attempt.workspace_id.is_none());
}

#[tokio::test]
async fn create_workflow_attempt_with_resources_binds_ready_workspace() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let repo_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_local_issue(&pool, project_id, issue_id, "Build workflow attempt").await;

    let workspace_resolver = FakeWorkspaceResolver::new(workspace_id);
    let attempt = create_issue_workflow_attempt_with_resources(
        &pool,
        project_id,
        issue_id,
        CreateWorkflowAttemptRequest {
            name: Some("Workflow attempt".to_string()),
            graph_json: valid_graph_json(),
            repos: Some(vec![DraftWorkspaceRepo {
                repo_id,
                target_branch: "main".to_string(),
            }]),
        },
        &workspace_resolver,
    )
    .await
    .expect("create workflow attempt with workspace");

    assert_eq!(attempt.project_id, project_id);
    assert_eq!(attempt.issue_id, issue_id);
    assert_eq!(attempt.status, WorkflowAttemptStatus::Ready);
    assert_eq!(attempt.workspace_id, Some(workspace_id));

    let requests = workspace_resolver.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].issue_id, issue_id);
    assert_eq!(requests[0].project_id, Some(project_id));
    assert!(requests[0].existing_workspace_id.is_none());
    assert_eq!(requests[0].repo_overrides.len(), 1);
    assert_eq!(requests[0].repo_overrides[0].repo_id, repo_id);
    assert_eq!(requests[0].repo_overrides[0].target_branch, "main");
}

#[tokio::test]
async fn list_project_workflows_excludes_attempt_owned_backing_workflows() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_local_issue(&pool, project_id, issue_id, "Draft hidden attempt").await;

    let attempt = create_issue_workflow_attempt(
        &pool,
        project_id,
        issue_id,
        CreateWorkflowAttemptRequest {
            name: Some("Hidden attempt graph".to_string()),
            graph_json: valid_graph_json(),
            repos: None,
        },
    )
    .await
    .expect("create workflow attempt");

    let workflows = list_project_workflows(&pool, project_id)
        .await
        .expect("list workflows");

    assert!(
        workflows
            .iter()
            .all(|workflow| workflow.id != attempt.workflow_id),
        "attempt-owned backing graph must not appear as reusable template"
    );
}

#[tokio::test]
async fn workflow_attempt_can_be_resolved_from_backing_workflow() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_local_issue(&pool, project_id, issue_id, "Open attempt canvas").await;

    let attempt = create_issue_workflow_attempt(
        &pool,
        project_id,
        issue_id,
        CreateWorkflowAttemptRequest {
            name: Some("Canvas-owned attempt".to_string()),
            graph_json: valid_graph_json(),
            repos: None,
        },
    )
    .await
    .expect("create workflow attempt");

    let resolved = workflow_attempt_by_workflow_id(&pool, attempt.workflow_id)
        .await
        .expect("query attempt by workflow")
        .expect("attempt exists for backing workflow");

    assert_eq!(resolved.id, attempt.id);
    assert_eq!(resolved.issue_id, issue_id);
    assert_eq!(resolved.workflow_id, attempt.workflow_id);
}

#[tokio::test]
async fn delete_workflow_attempt_removes_backing_graph_runs_and_nodes() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_local_issue(&pool, project_id, issue_id, "Delete attempt").await;

    let attempt = create_issue_workflow_attempt(
        &pool,
        project_id,
        issue_id,
        CreateWorkflowAttemptRequest {
            name: Some("Delete me".to_string()),
            graph_json: valid_graph_json(),
            repos: None,
        },
    )
    .await
    .expect("create workflow attempt");
    let run_id = Uuid::new_v4();
    let node_execution_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO workflow_runs
            (id, workflow_id, attempt_id, issue_id, trigger_source, input_text, status)
        VALUES (?, ?, ?, ?, 'manual', 'run it', 'failed')
        "#,
    )
    .bind(run_id)
    .bind(attempt.workflow_id)
    .bind(attempt.id)
    .bind(issue_id)
    .execute(&pool)
    .await
    .expect("insert workflow run");
    sqlx::query("UPDATE workflow_attempts SET latest_run_id = ?, status = 'failed' WHERE id = ?")
        .bind(run_id)
        .bind(attempt.id)
        .execute(&pool)
        .await
        .expect("link latest run");
    sqlx::query(
        r#"
        INSERT INTO node_executions
            (id, run_id, node_id, node_type, iteration, status)
        VALUES (?, ?, 'agent', 'agent', 0, 'failed')
        "#,
    )
    .bind(node_execution_id)
    .bind(run_id)
    .execute(&pool)
    .await
    .expect("insert node execution");

    delete_issue_workflow_attempt(&pool, attempt.id)
        .await
        .expect("delete workflow attempt");

    let attempt_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM workflow_attempts WHERE id = ?")
            .bind(attempt.id)
            .fetch_one(&pool)
            .await
            .expect("count attempts");
    let workflow_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workflows WHERE id = ?")
        .bind(attempt.workflow_id)
        .fetch_one(&pool)
        .await
        .expect("count workflows");
    let run_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM workflow_runs WHERE id = ?")
        .bind(run_id)
        .fetch_one(&pool)
        .await
        .expect("count runs");
    let node_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM node_executions WHERE id = ?")
        .bind(node_execution_id)
        .fetch_one(&pool)
        .await
        .expect("count node executions");

    assert_eq!(attempt_count, 0);
    assert_eq!(workflow_count, 0);
    assert_eq!(run_count, 0);
    assert_eq!(node_count, 0);
}

#[tokio::test]
async fn workflow_attempt_create_rejects_issue_from_another_project() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let other_project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_project(&pool, other_project_id).await;
    insert_local_issue(&pool, other_project_id, issue_id, "Wrong project").await;

    let err = create_issue_workflow_attempt(
        &pool,
        project_id,
        issue_id,
        CreateWorkflowAttemptRequest {
            name: Some("Invalid".to_string()),
            graph_json: valid_graph_json(),
            repos: None,
        },
    )
    .await
    .expect_err("issue must belong to project");

    assert!(err.to_string().contains("Issue not found for project"));
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
async fn update_project_workflow_accepts_parseable_draft_graph() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    let workflow_id = insert_project_workflow(&pool, project_id).await;

    let result = update_workflow_template(
        &pool,
        workflow_id,
        UpdateWorkflowRequest {
            name: None,
            description: None,
            graph_json: Some(unreachable_draft_graph_json()),
        },
    )
    .await
    .expect("draft graph update should be persisted before run validation");

    assert!(
        result.graph_json.contains("agent-draft"),
        "draft node configuration should survive workflow update"
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
    assert_eq!(workspace_requests[0].project_id, Some(project_id));
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
async fn running_workflow_attempt_updates_latest_run_workspace_and_status() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let repo_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_local_issue(&pool, project_id, issue_id, "Run workflow attempt").await;

    let attempt = create_issue_workflow_attempt(
        &pool,
        project_id,
        issue_id,
        CreateWorkflowAttemptRequest {
            name: Some("Attempt run".to_string()),
            graph_json: valid_graph_json(),
            repos: None,
        },
    )
    .await
    .expect("create workflow attempt");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(Uuid::new_v4(), "unused");
    let run = run_workflow_attempt_runtime(
        &pool,
        attempt.id,
        RunWorkflowAttemptRequest {
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Implement by workflow".to_string(),
            repos: Some(vec![DraftWorkspaceRepo {
                repo_id,
                target_branch: "develop".to_string(),
            }]),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("run workflow attempt");

    assert_eq!(run.attempt_id, Some(attempt.id));
    let refreshed = workflow_attempt_by_id(&pool, attempt.id)
        .await
        .expect("query attempt")
        .expect("attempt exists");
    assert_eq!(refreshed.latest_run_id, Some(run.id));
    assert_eq!(refreshed.workspace_id, Some(workspace_id));
    assert_eq!(refreshed.status, WorkflowAttemptStatus::Succeeded);

    let workspace_requests = workspace.requests();
    assert_eq!(workspace_requests.len(), 1);
    assert_eq!(workspace_requests[0].repo_overrides.len(), 1);
    assert_eq!(workspace_requests[0].repo_overrides[0].repo_id, repo_id);
    assert_eq!(
        workspace_requests[0].repo_overrides[0].target_branch,
        "develop"
    );
}

#[tokio::test]
async fn canceling_workflow_attempt_syncs_attempt_status() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_local_issue(&pool, project_id, issue_id, "Cancel workflow attempt").await;

    let attempt = create_issue_workflow_attempt(
        &pool,
        project_id,
        issue_id,
        CreateWorkflowAttemptRequest {
            name: Some("Cancel attempt".to_string()),
            graph_json: agent_graph_json(),
            repos: None,
        },
    )
    .await
    .expect("create workflow attempt");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = StartedAgentExecutor::new(session_id);
    let running = run_workflow_attempt_runtime(
        &pool,
        attempt.id,
        RunWorkflowAttemptRequest {
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Long task".to_string(),
            repos: None,
        },
        &workspace,
        &agent,
    )
    .await
    .expect("run workflow attempt");

    let canceller = FakeRunCanceller::default();
    let canceled = cancel_workflow_run_runtime(&pool, running.id, &canceller)
        .await
        .expect("cancel workflow run");
    sync_attempt_from_run(&pool, &canceled)
        .await
        .expect("sync attempt");

    let refreshed = workflow_attempt_by_id(&pool, attempt.id)
        .await
        .expect("query attempt")
        .expect("attempt exists");
    assert_eq!(refreshed.status, WorkflowAttemptStatus::Canceled);
    assert_eq!(refreshed.latest_run_id, Some(running.id));
}

#[tokio::test]
async fn workflow_runner_resolves_project_id_from_local_issue_for_system_workflow() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_local_issue(&pool, project_id, issue_id, "System workflow issue").await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'system', NULL, 'System Agent Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(agent_graph_json())
    .execute(&pool)
    .await
    .expect("insert system agent workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(session_id, "agent final output");

    let run = trigger_workflow_run(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Run system workflow".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("trigger system workflow run");

    assert_eq!(run.workspace_id, Some(workspace_id));
    let workspace_requests = workspace.requests();
    assert_eq!(workspace_requests.len(), 1);
    assert_eq!(workspace_requests[0].project_id, Some(project_id));
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
    assert_eq!(workspace.requests()[0].project_id, Some(project_id));
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
    let execution_process_id = Uuid::new_v4();
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
    let agent = FakeAgentExecutor::with_execution_process(
        session_id,
        execution_process_id,
        "implemented feature",
    );

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
    assert!(agent_requests[0].session_id.is_some());
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
    assert_eq!(agent_node.execution_process_id, Some(execution_process_id));
    assert_eq!(
        agent_node.output_text.as_deref(),
        Some("implemented feature")
    );
    assert_eq!(run.output_text.as_deref(), Some("implemented feature"));
}

#[tokio::test]
async fn workflow_reconcile_completed_agent_process_resumes_downstream_nodes() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let first_session_id = Uuid::new_v4();
    let first_execution_process_id = Uuid::new_v4();
    let second_session_id = Uuid::new_v4();
    let second_execution_process_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Two Agent Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(two_agent_graph_json())
    .execute(&pool)
    .await
    .expect("insert two-agent workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = AsyncThenCompleteAgentExecutor::new(
        first_session_id,
        first_execution_process_id,
        second_session_id,
        second_execution_process_id,
    );

    let running = trigger_workflow_run(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Run two agents".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("trigger workflow run");

    assert_eq!(running.status, WorkflowRunStatus::Running);
    assert_eq!(
        node_status(&running.nodes, "agent-a"),
        NodeExecutionStatus::Running
    );
    assert_eq!(agent.requests().len(), 1);

    insert_execution_process(
        &pool,
        first_execution_process_id,
        first_session_id,
        ExecutionProcessStatus::Completed,
        Some(0),
    )
    .await;

    let reconciled = reconcile_workflow_run(&pool, running.id, &agent)
        .await
        .expect("reconcile workflow run");

    let requests = agent.requests();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[1].node_id, "agent-b");
    assert_eq!(requests[1].prompt, "Agent B prompt");
    assert_eq!(reconciled.status, WorkflowRunStatus::Succeeded);
    assert_eq!(
        node_status(&reconciled.nodes, "agent-a"),
        NodeExecutionStatus::Succeeded
    );
    assert_eq!(
        node_status(&reconciled.nodes, "agent-b"),
        NodeExecutionStatus::Succeeded
    );
    assert_eq!(
        node_status(&reconciled.nodes, "end"),
        NodeExecutionStatus::Succeeded
    );
}

#[tokio::test]
async fn workflow_reconcile_failed_agent_process_fails_run_and_skips_downstream() {
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
    let running = trigger_workflow_run(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Run failing agent".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("trigger workflow run");

    insert_execution_process(
        &pool,
        agent.execution_process_id(),
        session_id,
        ExecutionProcessStatus::Failed,
        Some(1),
    )
    .await;

    let reconciled = reconcile_workflow_run(&pool, running.id, &agent)
        .await
        .expect("reconcile failed workflow run");

    assert_eq!(reconciled.status, WorkflowRunStatus::Failed);
    assert_eq!(
        node_status(&reconciled.nodes, "agent"),
        NodeExecutionStatus::Failed
    );
    assert_eq!(
        node_status(&reconciled.nodes, "end"),
        NodeExecutionStatus::Skipped
    );
}

#[tokio::test]
async fn workflow_runner_fan_in_triggers_same_agent_session_multiple_times() {
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
        VALUES (?, 'project', ?, 'Fan In Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(fan_in_agent_graph_json())
    .execute(&pool)
    .await
    .expect("insert fan-in workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(session_id, "reviewed branch");

    let run = trigger_workflow_run(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Fan-in should trigger twice".to_string(),
        },
        &workspace,
        &agent,
    )
    .await
    .expect("trigger workflow run");

    let agent_requests = agent.requests();
    assert_eq!(agent_requests.len(), 2);
    assert_eq!(agent_requests[0].node_id, "review");
    assert_eq!(agent_requests[1].node_id, "review");
    assert_eq!(agent_requests[0].session_id, agent_requests[1].session_id);
    assert_eq!(agent_requests[0].prompt, "Review the current worktree.");
    assert_eq!(agent_requests[1].prompt, "Review the current worktree.");

    let review_iterations = run
        .nodes
        .iter()
        .filter(|node| node.node_id == "review")
        .map(|node| node.iteration)
        .collect::<Vec<_>>();
    assert_eq!(review_iterations, vec![0, 1]);

    let end_iterations = run
        .nodes
        .iter()
        .filter(|node| node.node_id == "end")
        .map(|node| node.iteration)
        .collect::<Vec<_>>();
    assert_eq!(end_iterations, vec![0, 1]);
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
async fn workflow_arena_node_creates_group_and_waits_for_winner() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    let arena_group_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Arena Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(arena_graph_json())
    .execute(&pool)
    .await
    .expect("insert arena workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(session_id, "agent should not run");
    let arena = FakeArenaCreator::new(arena_group_id);

    let run = trigger_workflow_run_with_arena(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Build draw-more workflow".to_string(),
        },
        &workspace,
        &agent,
        &arena,
    )
    .await
    .expect("trigger workflow run");

    assert_eq!(run.status, WorkflowRunStatus::AwaitingArena);
    assert!(agent.requests().is_empty());
    assert_eq!(
        node_status(&run.nodes, "arena"),
        NodeExecutionStatus::AwaitingArena
    );
    assert_eq!(node_status(&run.nodes, "end"), NodeExecutionStatus::Pending);

    let arena_node = run
        .nodes
        .iter()
        .find(|node| node.node_id == "arena")
        .expect("arena node execution");
    assert_eq!(arena_node.arena_group_id, Some(arena_group_id));
    let arena_input = arena_node.input_text.as_deref().expect("arena input text");
    assert!(arena_input.contains("# Workflow Agent Envelope"));
    assert!(arena_input.contains("- Type: Arena step"));
    assert!(arena_input.contains("Implement candidates from Plan: Build draw-more workflow"));

    let arena_requests = arena.requests();
    assert_eq!(arena_requests.len(), 1);
    let request = &arena_requests[0];
    assert_eq!(request.run_id, run.id);
    assert_eq!(request.node_id, "arena");
    assert_eq!(request.issue_id, issue_id);
    assert_eq!(request.main_workspace_id, workspace_id);
    assert_eq!(request.prompt, arena_input);
    assert_eq!(request.attempts.len(), 3);
    assert_eq!(
        request
            .attempts
            .iter()
            .map(|attempt| attempt.branch_name.as_str())
            .collect::<Vec<_>>(),
        vec![
            format!("vk/{issue_id}-wf-{}-arena-1", short_run_id(run.id)),
            format!("vk/{issue_id}-wf-{}-arena-2", short_run_id(run.id)),
            format!("vk/{issue_id}-wf-{}-arena-3", short_run_id(run.id)),
        ]
    );
    assert_eq!(
        request
            .attempts
            .iter()
            .map(|attempt| attempt.prompt.as_str())
            .collect::<Vec<_>>(),
        vec![arena_input, arena_input, arena_input]
    );
    assert_eq!(
        request
            .attempts
            .iter()
            .map(|attempt| attempt.display_name.as_deref())
            .collect::<Vec<_>>(),
        vec![
            Some("Candidate A"),
            Some("Candidate B"),
            Some("Candidate C")
        ]
    );
}

#[tokio::test]
async fn workflow_arena_winner_selection_applies_winner_and_resumes_downstream_nodes() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let winner_workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    let arena_group_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Arena Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(arena_graph_json())
    .execute(&pool)
    .await
    .expect("insert arena workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(session_id, "agent should not run");
    let arena = FakeArenaCreator::new(arena_group_id);
    let winner = FakeArenaWinnerApplier::succeeds("Winner applied from Candidate B");

    let awaiting = trigger_workflow_run_with_arena(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Build draw-more workflow".to_string(),
        },
        &workspace,
        &agent,
        &arena,
    )
    .await
    .expect("trigger workflow run");
    assert_eq!(awaiting.status, WorkflowRunStatus::AwaitingArena);

    let completed = select_arena_winner_with_arena(
        &pool,
        awaiting.id,
        "arena",
        winner_workspace_id,
        &agent,
        &arena,
        &winner,
    )
    .await
    .expect("select arena winner");

    assert_eq!(completed.status, WorkflowRunStatus::Succeeded);
    assert_eq!(
        node_status(&completed.nodes, "arena"),
        NodeExecutionStatus::Succeeded
    );
    assert_eq!(
        node_status(&completed.nodes, "end"),
        NodeExecutionStatus::Succeeded
    );
    assert_eq!(
        completed.output_text.as_deref(),
        Some("Winner applied from Candidate B")
    );

    let arena_node = completed
        .nodes
        .iter()
        .find(|node| node.node_id == "arena")
        .expect("arena node execution");
    assert_eq!(
        arena_node.output_text.as_deref(),
        Some("Winner applied from Candidate B")
    );

    let requests = winner.requests();
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].run_id, awaiting.id);
    assert_eq!(requests[0].node_id, "arena");
    assert_eq!(requests[0].arena_group_id, arena_group_id);
    assert_eq!(requests[0].main_workspace_id, workspace_id);
    assert_eq!(requests[0].winner_workspace_id, winner_workspace_id);
}

#[tokio::test]
async fn workflow_arena_winner_apply_failure_fails_run_with_conflict_text() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let winner_workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    let arena_group_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Arena Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(arena_graph_json())
    .execute(&pool)
    .await
    .expect("insert arena workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(session_id, "agent should not run");
    let arena = FakeArenaCreator::new(arena_group_id);
    let winner = FakeArenaWinnerApplier::fails("winner diff conflict in src/main.rs");

    let awaiting = trigger_workflow_run_with_arena(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Build draw-more workflow".to_string(),
        },
        &workspace,
        &agent,
        &arena,
    )
    .await
    .expect("trigger workflow run");

    let failed = select_arena_winner_with_arena(
        &pool,
        awaiting.id,
        "arena",
        winner_workspace_id,
        &agent,
        &arena,
        &winner,
    )
    .await
    .expect("select arena winner reports failed run");

    assert_eq!(failed.status, WorkflowRunStatus::Failed);
    assert_eq!(
        node_status(&failed.nodes, "arena"),
        NodeExecutionStatus::Failed
    );
    assert_eq!(
        node_status(&failed.nodes, "end"),
        NodeExecutionStatus::Skipped
    );
    assert!(
        failed
            .error_text
            .as_deref()
            .is_some_and(|message| message.contains("winner diff conflict"))
    );
}

#[tokio::test]
async fn workflow_arena_winner_selection_requires_awaiting_arena_node() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let workspace_id = Uuid::new_v4();
    let winner_workspace_id = Uuid::new_v4();
    let session_id = Uuid::new_v4();
    let arena_group_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Arena Flow', NULL, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(arena_graph_json())
    .execute(&pool)
    .await
    .expect("insert arena workflow");

    let workspace = FakeWorkspaceResolver::new(workspace_id);
    let agent = FakeAgentExecutor::new(session_id, "agent should not run");
    let arena = FakeArenaCreator::new(arena_group_id);
    let winner = FakeArenaWinnerApplier::succeeds("Winner should not apply");

    let awaiting = trigger_workflow_run_with_arena(
        &pool,
        workflow_id,
        TriggerWorkflowRequest {
            issue_id,
            workspace_id: None,
            trigger_source: "manual".to_string(),
            input_text: "Build draw-more workflow".to_string(),
        },
        &workspace,
        &agent,
        &arena,
    )
    .await
    .expect("trigger workflow run");
    sqlx::query(
        r#"
        UPDATE node_executions
        SET status = 'succeeded'
        WHERE run_id = ? AND node_id = 'arena'
        "#,
    )
    .bind(awaiting.id)
    .execute(&pool)
    .await
    .expect("force arena node succeeded");

    let result = select_arena_winner_with_arena(
        &pool,
        awaiting.id,
        "arena",
        winner_workspace_id,
        &agent,
        &arena,
        &winner,
    )
    .await;

    assert!(
        result
            .expect_err("winner selection should require awaiting_arena")
            .to_string()
            .contains("must be `awaiting_arena`")
    );
    assert!(winner.requests().is_empty());
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
async fn workflow_run_rejects_condition_without_router_config() {
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

    let result = trigger_workflow_run(
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
    .await;

    assert!(
        matches!(
            result,
            Err(ApiError::BadRequest(message))
                if message.contains("workflow with condition nodes requires router executor config")
        ),
        "condition workflows without an explicit router config must be blocked before run"
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
async fn recovery_syncs_attempt_status_for_stale_running_run() {
    let pool = setup_workflow_pool().await;
    let project_id = Uuid::new_v4();
    let issue_id = Uuid::new_v4();
    let workflow_id = Uuid::new_v4();
    let attempt_id = Uuid::new_v4();
    let run_id = Uuid::new_v4();
    let node_execution_id = Uuid::new_v4();
    insert_project(&pool, project_id).await;
    insert_local_issue(&pool, project_id, issue_id, "Recover attempt").await;

    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, 'Recover Flow', NULL, ?)
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
        INSERT INTO workflow_attempts
            (id, project_id, issue_id, workflow_id, name, status)
        VALUES (?, ?, ?, ?, 'Recover attempt', 'running')
        "#,
    )
    .bind(attempt_id)
    .bind(project_id)
    .bind(issue_id)
    .bind(workflow_id)
    .execute(&pool)
    .await
    .expect("insert attempt");

    sqlx::query(
        r#"
        INSERT INTO workflow_runs
            (id, workflow_id, attempt_id, issue_id, workspace_id, trigger_source, input_text, status)
        VALUES (?, ?, ?, ?, NULL, 'manual', 'Recover this', 'running')
        "#,
    )
    .bind(run_id)
    .bind(workflow_id)
    .bind(attempt_id)
    .bind(issue_id)
    .execute(&pool)
    .await
    .expect("insert run");

    sqlx::query("UPDATE workflow_attempts SET latest_run_id = ? WHERE id = ?")
        .bind(run_id)
        .bind(attempt_id)
        .execute(&pool)
        .await
        .expect("link attempt latest run");

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
    assert_eq!(recovered, 1);

    let attempt_status: String =
        sqlx::query_scalar("SELECT status FROM workflow_attempts WHERE id = ?")
            .bind(attempt_id)
            .fetch_one(&pool)
            .await
            .expect("fetch attempt status");
    assert_eq!(attempt_status, "failed");
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
