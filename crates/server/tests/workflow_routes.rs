use db::models::workflow::WorkflowSource;
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

fn assert_payload_array_key(payload: &Value, key: &str) {
    assert!(
        payload.get(key).and_then(Value::as_array).is_some(),
        "fallback payload should include an array at `{key}`"
    );
}
