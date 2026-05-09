use api_types::{DeleteResponse, MutationResponse};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::Json as ResponseJson,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use db::models::workflow::{NodeExecutionStatus, WorkflowRunStatus, WorkflowSource};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Row, SqlitePool, sqlite::SqliteRow};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;
use workflow::{WorkflowGraph, templates::built_in_templates, validation::validate_graph};

use crate::{
    DeploymentImpl,
    error::ApiError,
    workflow_runtime::{
        runner::{
            DeploymentWorkflowAgentExecutor, get_workflow_run_response, trigger_workflow_run,
        },
        workspace::DeploymentWorkflowWorkspaceResolver,
    },
};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowTemplateResponse {
    pub id: Uuid,
    pub source: WorkflowSource,
    pub project_id: Option<Uuid>,
    pub name: String,
    pub description: Option<String>,
    pub graph_json: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowTemplateListResponse {
    pub workflows: Vec<WorkflowTemplateResponse>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateWorkflowRequest {
    pub name: String,
    pub description: Option<String>,
    pub graph_json: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UpdateWorkflowRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub graph_json: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct TriggerWorkflowRequest {
    pub issue_id: Uuid,
    pub workspace_id: Option<Uuid>,
    pub trigger_source: String,
    pub input_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowRunResponse {
    pub id: Uuid,
    pub workflow_id: Uuid,
    pub issue_id: Uuid,
    pub workspace_id: Option<Uuid>,
    pub trigger_source: String,
    pub input_text: String,
    pub output_text: Option<String>,
    pub status: WorkflowRunStatus,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub error_text: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub nodes: Vec<WorkflowNodeExecutionResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowNodeExecutionResponse {
    pub id: Uuid,
    pub run_id: Uuid,
    pub node_id: String,
    pub node_type: String,
    pub iteration: i64,
    pub status: NodeExecutionStatus,
    pub input_text: Option<String>,
    pub output_text: Option<String>,
    pub session_id: Option<Uuid>,
    pub arena_group_id: Option<Uuid>,
    pub tokens_used: Option<i64>,
    pub cost_estimate: Option<f64>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub error_text: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowActionResponse {
    pub run_id: Uuid,
    pub node_id: Option<String>,
    pub status: WorkflowRunStatus,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FallbackWorkflowsQuery {
    pub project_id: Option<Uuid>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FallbackWorkflowRunsQuery {
    pub issue_id: Option<Uuid>,
    pub workflow_id: Option<Uuid>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FallbackNodeExecutionsQuery {
    pub run_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
struct WorkflowRunFallbackRow {
    pub id: Uuid,
    pub workflow_id: Uuid,
    pub issue_id: Uuid,
    pub workspace_id: Option<Uuid>,
    pub trigger_source: String,
    pub input_text: String,
    pub output_text: Option<String>,
    pub status: WorkflowRunStatus,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub error_text: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize)]
struct NodeExecutionFallbackRow {
    pub id: Uuid,
    pub run_id: Uuid,
    pub node_id: String,
    pub node_type: String,
    pub iteration: i64,
    pub status: NodeExecutionStatus,
    pub input_text: Option<String>,
    pub output_text: Option<String>,
    pub session_id: Option<Uuid>,
    pub arena_group_id: Option<Uuid>,
    pub tokens_used: Option<i64>,
    pub cost_estimate: Option<f64>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub error_text: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Error)]
enum WorkflowRouteError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("{0}")]
    BadRequest(String),
}

impl From<WorkflowRouteError> for ApiError {
    fn from(error: WorkflowRouteError) -> Self {
        match error {
            WorkflowRouteError::Database(err) => ApiError::Database(err),
            WorkflowRouteError::BadRequest(message) => ApiError::BadRequest(message),
        }
    }
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    Router::new()
        .route(
            "/v1/projects/{project_id}/workflows",
            get(list_workflows).post(create_workflow),
        )
        .route(
            "/v1/workflows/{workflow_id}",
            get(get_workflow)
                .put(update_workflow)
                .delete(delete_workflow),
        )
        .route(
            "/v1/workflows/{workflow_id}/trigger",
            post(trigger_workflow),
        )
        .route("/v1/workflow-runs/{run_id}", get(get_workflow_run))
        .route(
            "/v1/workflow-runs/{run_id}/cancel",
            post(cancel_workflow_run),
        )
        .route(
            "/v1/workflow-runs/{run_id}/events",
            get(workflow_run_events),
        )
        .route(
            "/v1/workflow-runs/{run_id}/nodes/{node_id}/retry",
            post(retry_node),
        )
        .route(
            "/v1/workflow-runs/{run_id}/nodes/{node_id}/approve",
            post(approve_node),
        )
        .route(
            "/v1/workflow-runs/{run_id}/nodes/{node_id}/reject",
            post(reject_node),
        )
        .route(
            "/v1/workflow-runs/{run_id}/nodes/{node_id}/arena-winner",
            post(select_arena_winner),
        )
        .with_state(deployment.clone())
}

async fn list_workflows(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<WorkflowTemplateListResponse>, ApiError> {
    Ok(ResponseJson(WorkflowTemplateListResponse {
        workflows: list_project_workflows(&deployment.db().pool, project_id).await?,
    }))
}

async fn create_workflow(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(request): Json<CreateWorkflowRequest>,
) -> Result<ResponseJson<MutationResponse<WorkflowTemplateResponse>>, ApiError> {
    let data = create_project_workflow(&deployment.db().pool, project_id, request).await?;
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn get_workflow(
    State(deployment): State<DeploymentImpl>,
    Path(workflow_id): Path<Uuid>,
) -> Result<ResponseJson<WorkflowTemplateResponse>, ApiError> {
    Ok(ResponseJson(
        get_workflow_template(&deployment.db().pool, workflow_id).await?,
    ))
}

async fn update_workflow(
    State(deployment): State<DeploymentImpl>,
    Path(workflow_id): Path<Uuid>,
    Json(request): Json<UpdateWorkflowRequest>,
) -> Result<ResponseJson<MutationResponse<WorkflowTemplateResponse>>, ApiError> {
    let data = update_workflow_template(&deployment.db().pool, workflow_id, request).await?;
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn delete_workflow(
    State(deployment): State<DeploymentImpl>,
    Path(workflow_id): Path<Uuid>,
) -> Result<ResponseJson<DeleteResponse>, ApiError> {
    delete_workflow_template(&deployment.db().pool, workflow_id).await?;
    Ok(ResponseJson(DeleteResponse { txid: txid() }))
}

pub async fn list_project_workflows(
    pool: &SqlitePool,
    project_id: Uuid,
) -> Result<Vec<WorkflowTemplateResponse>, ApiError> {
    ensure_system_workflows(pool).await?;

    let rows = sqlx::query(
        r#"
        SELECT id, source, project_id, name, description, graph_json, created_at, updated_at
        FROM workflows
        WHERE source = 'system' OR project_id = ?
        ORDER BY
            CASE source WHEN 'system' THEN 0 ELSE 1 END,
            name ASC,
            created_at ASC
        "#,
    )
    .bind(project_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(workflow_template_from_row)
        .collect::<Result<Vec<_>, _>>()?)
}

pub async fn create_project_workflow(
    pool: &SqlitePool,
    project_id: Uuid,
    request: CreateWorkflowRequest,
) -> Result<WorkflowTemplateResponse, ApiError> {
    ensure_project_exists(pool, project_id).await?;
    validate_graph_json(&request.graph_json)?;

    let workflow_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO workflows (id, source, project_id, name, description, graph_json)
        VALUES (?, 'project', ?, ?, ?, ?)
        "#,
    )
    .bind(workflow_id)
    .bind(project_id)
    .bind(request.name)
    .bind(request.description)
    .bind(request.graph_json)
    .execute(pool)
    .await?;

    workflow_by_id(pool, workflow_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow not found after create".to_string()))
}

pub async fn get_workflow_template(
    pool: &SqlitePool,
    workflow_id: Uuid,
) -> Result<WorkflowTemplateResponse, ApiError> {
    ensure_system_workflows(pool).await?;
    workflow_by_id(pool, workflow_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow not found".to_string()))
}

pub async fn update_workflow_template(
    pool: &SqlitePool,
    workflow_id: Uuid,
    request: UpdateWorkflowRequest,
) -> Result<WorkflowTemplateResponse, ApiError> {
    ensure_system_workflows(pool).await?;
    let existing = workflow_by_id(pool, workflow_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow not found".to_string()))?;

    if existing.source == WorkflowSource::System {
        return Err(ApiError::Forbidden(
            "system workflow templates cannot be updated".to_string(),
        ));
    }

    if let Some(graph_json) = request.graph_json.as_deref() {
        validate_graph_json(graph_json)?;
    }

    sqlx::query(
        r#"
        UPDATE workflows
        SET name = ?, description = ?, graph_json = ?, updated_at = datetime('now', 'subsec')
        WHERE id = ?
        "#,
    )
    .bind(request.name.unwrap_or(existing.name))
    .bind(request.description.or(existing.description))
    .bind(request.graph_json.unwrap_or(existing.graph_json))
    .bind(workflow_id)
    .execute(pool)
    .await?;

    workflow_by_id(pool, workflow_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow not found after update".to_string()))
}

pub async fn delete_workflow_template(
    pool: &SqlitePool,
    workflow_id: Uuid,
) -> Result<(), ApiError> {
    ensure_system_workflows(pool).await?;
    let existing = workflow_by_id(pool, workflow_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow not found".to_string()))?;

    if existing.source == WorkflowSource::System {
        return Err(ApiError::Forbidden(
            "system workflow templates cannot be deleted".to_string(),
        ));
    }

    sqlx::query("DELETE FROM workflows WHERE id = ?")
        .bind(workflow_id)
        .execute(pool)
        .await?;

    Ok(())
}

pub async fn fallback_workflows_payload(
    pool: &SqlitePool,
    project_id: Option<Uuid>,
) -> Result<Value, ApiError> {
    let workflows = match project_id {
        Some(project_id) => list_project_workflows(pool, project_id).await?,
        None => list_all_workflows(pool).await?,
    };

    Ok(json!({ "workflows": workflows }))
}

pub async fn fallback_workflow_runs_payload(
    pool: &SqlitePool,
    issue_id: Option<Uuid>,
    workflow_id: Option<Uuid>,
) -> Result<Value, ApiError> {
    let rows = workflow_run_rows(pool, issue_id, workflow_id).await?;
    Ok(json!({ "workflow_runs": rows }))
}

pub async fn fallback_node_executions_payload(
    pool: &SqlitePool,
    run_id: Option<Uuid>,
) -> Result<Value, ApiError> {
    let rows = node_execution_rows(pool, run_id).await?;
    Ok(json!({ "node_executions": rows }))
}

async fn list_all_workflows(pool: &SqlitePool) -> Result<Vec<WorkflowTemplateResponse>, ApiError> {
    ensure_system_workflows(pool).await?;

    let rows = sqlx::query(
        r#"
        SELECT id, source, project_id, name, description, graph_json, created_at, updated_at
        FROM workflows
        ORDER BY
            CASE source WHEN 'system' THEN 0 ELSE 1 END,
            name ASC,
            created_at ASC
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(workflow_template_from_row)
        .collect::<Result<Vec<_>, _>>()?)
}

async fn workflow_by_id(
    pool: &SqlitePool,
    workflow_id: Uuid,
) -> Result<Option<WorkflowTemplateResponse>, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT id, source, project_id, name, description, graph_json, created_at, updated_at
        FROM workflows
        WHERE id = ?
        "#,
    )
    .bind(workflow_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.as_ref().map(workflow_template_from_row).transpose()?)
}

async fn ensure_system_workflows(pool: &SqlitePool) -> Result<(), ApiError> {
    for template in built_in_templates() {
        validate_graph(&template.graph).map_err(|err| {
            ApiError::BadRequest(format!("Invalid built-in workflow graph: {err}"))
        })?;
        let workflow_id = Uuid::parse_str(template.id).map_err(|err| {
            ApiError::BadRequest(format!(
                "Invalid built-in workflow id `{}`: {err}",
                template.id
            ))
        })?;
        let graph_json = serde_json::to_string(&template.graph).map_err(|err| {
            ApiError::BadRequest(format!("Invalid built-in workflow graph JSON: {err}"))
        })?;

        sqlx::query(
            r#"
            INSERT INTO workflows (id, source, project_id, name, description, graph_json)
            VALUES (?, 'system', NULL, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                source = 'system',
                project_id = NULL,
                name = excluded.name,
                description = excluded.description,
                graph_json = excluded.graph_json,
                updated_at = datetime('now', 'subsec')
            WHERE
                workflows.source != excluded.source
                OR workflows.project_id IS NOT NULL
                OR workflows.name != excluded.name
                OR COALESCE(workflows.description, '') != COALESCE(excluded.description, '')
                OR workflows.graph_json != excluded.graph_json
            "#,
        )
        .bind(workflow_id)
        .bind(template.name)
        .bind(template.description)
        .bind(graph_json)
        .execute(pool)
        .await?;
    }

    Ok(())
}

fn validate_graph_json(graph_json: &str) -> Result<(), WorkflowRouteError> {
    let graph: WorkflowGraph = serde_json::from_str(graph_json).map_err(|err| {
        WorkflowRouteError::BadRequest(format!("Invalid workflow graph JSON: {err}"))
    })?;
    validate_graph(&graph)
        .map_err(|err| WorkflowRouteError::BadRequest(format!("Invalid workflow graph: {err}")))?;
    Ok(())
}

async fn ensure_project_exists(pool: &SqlitePool, project_id: Uuid) -> Result<(), ApiError> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = ?")
        .bind(project_id)
        .fetch_one(pool)
        .await?;
    if count == 0 {
        return Err(ApiError::BadRequest("Project not found".to_string()));
    }

    Ok(())
}

fn workflow_template_from_row(
    row: &SqliteRow,
) -> Result<WorkflowTemplateResponse, WorkflowRouteError> {
    Ok(WorkflowTemplateResponse {
        id: row.try_get("id")?,
        source: workflow_source_from_str(&row.try_get::<String, _>("source")?)?,
        project_id: row.try_get("project_id")?,
        name: row.try_get("name")?,
        description: row.try_get("description")?,
        graph_json: row.try_get("graph_json")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn workflow_run_from_row(row: &SqliteRow) -> Result<WorkflowRunFallbackRow, WorkflowRouteError> {
    Ok(WorkflowRunFallbackRow {
        id: row.try_get("id")?,
        workflow_id: row.try_get("workflow_id")?,
        issue_id: row.try_get("issue_id")?,
        workspace_id: row.try_get("workspace_id")?,
        trigger_source: row.try_get("trigger_source")?,
        input_text: row.try_get("input_text")?,
        output_text: row.try_get("output_text")?,
        status: workflow_run_status_from_str(&row.try_get::<String, _>("status")?)?,
        started_at: row.try_get("started_at")?,
        finished_at: row.try_get("finished_at")?,
        error_text: row.try_get("error_text")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn node_execution_from_row(
    row: &SqliteRow,
) -> Result<NodeExecutionFallbackRow, WorkflowRouteError> {
    Ok(NodeExecutionFallbackRow {
        id: row.try_get("id")?,
        run_id: row.try_get("run_id")?,
        node_id: row.try_get("node_id")?,
        node_type: row.try_get("node_type")?,
        iteration: row.try_get("iteration")?,
        status: node_execution_status_from_str(&row.try_get::<String, _>("status")?)?,
        input_text: row.try_get("input_text")?,
        output_text: row.try_get("output_text")?,
        session_id: row.try_get("session_id")?,
        arena_group_id: row.try_get("arena_group_id")?,
        tokens_used: row.try_get("tokens_used")?,
        cost_estimate: row.try_get("cost_estimate")?,
        started_at: row.try_get("started_at")?,
        finished_at: row.try_get("finished_at")?,
        error_text: row.try_get("error_text")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn workflow_run_rows(
    pool: &SqlitePool,
    issue_id: Option<Uuid>,
    workflow_id: Option<Uuid>,
) -> Result<Vec<WorkflowRunFallbackRow>, ApiError> {
    let select = r#"
        SELECT id, workflow_id, issue_id, workspace_id, trigger_source, input_text,
               output_text, status, started_at, finished_at, error_text, created_at, updated_at
        FROM workflow_runs
    "#;

    let rows = match (issue_id, workflow_id) {
        (Some(issue_id), Some(workflow_id)) => {
            sqlx::query(&format!(
                "{select} WHERE issue_id = ? AND workflow_id = ? ORDER BY created_at ASC"
            ))
            .bind(issue_id)
            .bind(workflow_id)
            .fetch_all(pool)
            .await?
        }
        (Some(issue_id), None) => {
            sqlx::query(&format!(
                "{select} WHERE issue_id = ? ORDER BY created_at ASC"
            ))
            .bind(issue_id)
            .fetch_all(pool)
            .await?
        }
        (None, Some(workflow_id)) => {
            sqlx::query(&format!(
                "{select} WHERE workflow_id = ? ORDER BY created_at ASC"
            ))
            .bind(workflow_id)
            .fetch_all(pool)
            .await?
        }
        (None, None) => {
            sqlx::query(&format!("{select} ORDER BY created_at ASC"))
                .fetch_all(pool)
                .await?
        }
    };

    Ok(rows
        .iter()
        .map(workflow_run_from_row)
        .collect::<Result<Vec<_>, _>>()?)
}

async fn node_execution_rows(
    pool: &SqlitePool,
    run_id: Option<Uuid>,
) -> Result<Vec<NodeExecutionFallbackRow>, ApiError> {
    let select = r#"
        SELECT id, run_id, node_id, node_type, iteration, status, input_text, output_text,
               session_id, arena_group_id, tokens_used, cost_estimate, started_at, finished_at,
               error_text, created_at, updated_at
        FROM node_executions
    "#;

    let rows = match run_id {
        Some(run_id) => {
            sqlx::query(&format!(
                "{select} WHERE run_id = ? ORDER BY iteration ASC, created_at ASC"
            ))
            .bind(run_id)
            .fetch_all(pool)
            .await?
        }
        None => {
            sqlx::query(&format!("{select} ORDER BY created_at ASC"))
                .fetch_all(pool)
                .await?
        }
    };

    Ok(rows
        .iter()
        .map(node_execution_from_row)
        .collect::<Result<Vec<_>, _>>()?)
}

fn workflow_source_from_str(value: &str) -> Result<WorkflowSource, WorkflowRouteError> {
    match value {
        "system" => Ok(WorkflowSource::System),
        "project" => Ok(WorkflowSource::Project),
        other => Err(WorkflowRouteError::BadRequest(format!(
            "Unknown workflow source `{other}`"
        ))),
    }
}

fn workflow_run_status_from_str(value: &str) -> Result<WorkflowRunStatus, WorkflowRouteError> {
    match value {
        "pending" => Ok(WorkflowRunStatus::Pending),
        "running" => Ok(WorkflowRunStatus::Running),
        "awaiting_human" => Ok(WorkflowRunStatus::AwaitingHuman),
        "awaiting_arena" => Ok(WorkflowRunStatus::AwaitingArena),
        "succeeded" => Ok(WorkflowRunStatus::Succeeded),
        "failed" => Ok(WorkflowRunStatus::Failed),
        "canceled" => Ok(WorkflowRunStatus::Canceled),
        other => Err(WorkflowRouteError::BadRequest(format!(
            "Unknown workflow run status `{other}`"
        ))),
    }
}

fn node_execution_status_from_str(value: &str) -> Result<NodeExecutionStatus, WorkflowRouteError> {
    match value {
        "pending" => Ok(NodeExecutionStatus::Pending),
        "running" => Ok(NodeExecutionStatus::Running),
        "awaiting_human" => Ok(NodeExecutionStatus::AwaitingHuman),
        "awaiting_arena" => Ok(NodeExecutionStatus::AwaitingArena),
        "succeeded" => Ok(NodeExecutionStatus::Succeeded),
        "failed" => Ok(NodeExecutionStatus::Failed),
        "skipped" => Ok(NodeExecutionStatus::Skipped),
        other => Err(WorkflowRouteError::BadRequest(format!(
            "Unknown node execution status `{other}`"
        ))),
    }
}

fn txid() -> i64 {
    Utc::now().timestamp_millis()
}

async fn trigger_workflow(
    State(deployment): State<DeploymentImpl>,
    Path(workflow_id): Path<Uuid>,
    Json(request): Json<TriggerWorkflowRequest>,
) -> Result<ResponseJson<MutationResponse<WorkflowRunResponse>>, ApiError> {
    let workspace_resolver = DeploymentWorkflowWorkspaceResolver::new(deployment.clone());
    let agent_executor = DeploymentWorkflowAgentExecutor::new(deployment.clone());
    let data = trigger_workflow_run(
        &deployment.db().pool,
        workflow_id,
        request,
        &workspace_resolver,
        &agent_executor,
    )
    .await?;

    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn get_workflow_run(
    State(deployment): State<DeploymentImpl>,
    Path(run_id): Path<Uuid>,
) -> Result<ResponseJson<WorkflowRunResponse>, ApiError> {
    Ok(ResponseJson(
        get_workflow_run_response(&deployment.db().pool, run_id).await?,
    ))
}

async fn cancel_workflow_run(Path(_run_id): Path<Uuid>) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn workflow_run_events(Path(_run_id): Path<Uuid>) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn retry_node(Path((_run_id, _node_id)): Path<(Uuid, String)>) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn approve_node(Path((_run_id, _node_id)): Path<(Uuid, String)>) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn reject_node(Path((_run_id, _node_id)): Path<(Uuid, String)>) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn select_arena_winner(Path((_run_id, _node_id)): Path<(Uuid, String)>) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}
