use api_types::{DeleteResponse, MutationResponse};
use axum::{
    BoxError, Json, Router,
    extract::{Path, State},
    response::{
        Json as ResponseJson, Sse,
        sse::{Event, KeepAlive},
    },
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use db::models::{
    session::{CreateSession, Session},
    workflow::{NodeExecutionStatus, WorkflowAttemptStatus, WorkflowRunStatus, WorkflowSource},
};
use deployment::Deployment;
use futures_util::{StreamExt, stream};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Row, SqlitePool, sqlite::SqliteRow};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;
use workflow::{
    WorkflowGraph, graph::WorkflowNodeKind, templates::built_in_templates,
    validation::validate_graph,
};

use crate::{
    DeploymentImpl,
    error::ApiError,
    workflow_runtime::{
        arena::{
            DeploymentWorkflowArenaCreator, DeploymentWorkflowArenaWinnerApplier,
            NoopWorkflowArenaCreator, WorkflowArenaCreator,
        },
        runner::{
            DeploymentWorkflowAgentExecutor, DeploymentWorkflowRunCanceller, WorkflowAgentExecutor,
            WorkflowWorkspaceRequest, WorkflowWorkspaceResolver, approve_human_node_with_arena,
            cancel_workflow_run_runtime, get_workflow_run_response, reject_human_node,
            retry_workflow_node_with_arena, select_arena_winner_with_arena,
            subscribe_workflow_events, trigger_workflow_run_for_attempt_with_arena,
            trigger_workflow_run_with_arena, workflow_event_history,
        },
        workspace::{DeploymentWorkflowWorkspaceResolver, main_workflow_branch_name},
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

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateWorkflowAttemptRequest {
    pub name: Option<String>,
    pub graph_json: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct RunWorkflowAttemptRequest {
    pub workspace_id: Option<Uuid>,
    pub trigger_source: String,
    pub input_text: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct SelectArenaWinnerRequest {
    pub workspace_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowAttemptResponse {
    pub id: Uuid,
    pub project_id: Uuid,
    pub issue_id: Uuid,
    pub workflow_id: Uuid,
    pub latest_run_id: Option<Uuid>,
    pub workspace_id: Option<Uuid>,
    pub name: String,
    pub status: WorkflowAttemptStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowAttemptListResponse {
    pub attempts: Vec<WorkflowAttemptResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct WorkflowRunResponse {
    pub id: Uuid,
    pub workflow_id: Uuid,
    pub attempt_id: Option<Uuid>,
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
    pub execution_process_id: Option<Uuid>,
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
    pub attempt_id: Option<Uuid>,
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
    pub execution_process_id: Option<Uuid>,
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
            "/v1/projects/{project_id}/issues/{issue_id}/workflow-attempts",
            get(list_issue_workflow_attempts).post(create_workflow_attempt),
        )
        .route(
            "/v1/workflows/{workflow_id}",
            get(get_workflow)
                .put(update_workflow)
                .delete(delete_workflow),
        )
        .route(
            "/v1/workflows/{workflow_id}/attempt",
            get(get_workflow_attempt_by_workflow),
        )
        .route(
            "/v1/workflows/{workflow_id}/trigger",
            post(trigger_workflow),
        )
        .route("/v1/workflow-runs/{run_id}", get(get_workflow_run))
        .route(
            "/v1/workflow-attempts/{attempt_id}",
            get(get_workflow_attempt),
        )
        .route(
            "/v1/workflow-attempts/{attempt_id}/run",
            post(run_workflow_attempt),
        )
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

async fn list_issue_workflow_attempts(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
) -> Result<ResponseJson<WorkflowAttemptListResponse>, ApiError> {
    Ok(ResponseJson(WorkflowAttemptListResponse {
        attempts: list_workflow_attempts_for_issue(&deployment.db().pool, project_id, issue_id)
            .await?,
    }))
}

async fn create_workflow_attempt(
    State(deployment): State<DeploymentImpl>,
    Path((project_id, issue_id)): Path<(Uuid, Uuid)>,
    Json(request): Json<CreateWorkflowAttemptRequest>,
) -> Result<ResponseJson<MutationResponse<WorkflowAttemptResponse>>, ApiError> {
    let workspace_resolver = DeploymentWorkflowWorkspaceResolver::new(deployment.clone());
    let data = create_issue_workflow_attempt_with_resources(
        &deployment.db().pool,
        project_id,
        issue_id,
        request,
        &workspace_resolver,
    )
    .await?;
    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn get_workflow_attempt(
    State(deployment): State<DeploymentImpl>,
    Path(attempt_id): Path<Uuid>,
) -> Result<ResponseJson<WorkflowAttemptResponse>, ApiError> {
    Ok(ResponseJson(
        workflow_attempt_by_id(&deployment.db().pool, attempt_id)
            .await?
            .ok_or_else(|| ApiError::BadRequest("Workflow attempt not found".to_string()))?,
    ))
}

async fn get_workflow_attempt_by_workflow(
    State(deployment): State<DeploymentImpl>,
    Path(workflow_id): Path<Uuid>,
) -> Result<ResponseJson<Option<WorkflowAttemptResponse>>, ApiError> {
    Ok(ResponseJson(
        workflow_attempt_by_workflow_id(&deployment.db().pool, workflow_id).await?,
    ))
}

async fn run_workflow_attempt(
    State(deployment): State<DeploymentImpl>,
    Path(attempt_id): Path<Uuid>,
    Json(request): Json<RunWorkflowAttemptRequest>,
) -> Result<ResponseJson<MutationResponse<WorkflowRunResponse>>, ApiError> {
    let workspace_resolver = DeploymentWorkflowWorkspaceResolver::new(deployment.clone());
    let agent_executor = DeploymentWorkflowAgentExecutor::new(deployment.clone());
    let arena_creator = DeploymentWorkflowArenaCreator::new(deployment.clone());
    let data = run_workflow_attempt_runtime_with_arena(
        &deployment.db().pool,
        attempt_id,
        request,
        &workspace_resolver,
        &agent_executor,
        &arena_creator,
    )
    .await?;

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
        WHERE (source = 'system' OR project_id = ?)
          AND id NOT IN (SELECT workflow_id FROM workflow_attempts)
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

pub async fn create_issue_workflow_attempt(
    pool: &SqlitePool,
    project_id: Uuid,
    issue_id: Uuid,
    request: CreateWorkflowAttemptRequest,
) -> Result<WorkflowAttemptResponse, ApiError> {
    ensure_project_exists(pool, project_id).await?;
    ensure_issue_belongs_to_project(pool, project_id, issue_id).await?;
    validate_graph_json(&request.graph_json)?;

    let name = request
        .name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Workflow attempt".to_string());

    let workflow = create_project_workflow(
        pool,
        project_id,
        CreateWorkflowRequest {
            name: name.clone(),
            description: Some(
                "Issue-bound workflow attempt backing graph. Hidden from template lists."
                    .to_string(),
            ),
            graph_json: request.graph_json,
        },
    )
    .await?;

    let attempt_id = Uuid::new_v4();
    sqlx::query(
        r#"
        INSERT INTO workflow_attempts
            (id, project_id, issue_id, workflow_id, name, status)
        VALUES (?, ?, ?, ?, ?, 'draft')
        "#,
    )
    .bind(attempt_id)
    .bind(project_id)
    .bind(issue_id)
    .bind(workflow.id)
    .bind(name)
    .execute(pool)
    .await?;

    workflow_attempt_by_id(pool, attempt_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow attempt not found after create".to_string()))
}

pub async fn create_issue_workflow_attempt_with_resources<W>(
    pool: &SqlitePool,
    project_id: Uuid,
    issue_id: Uuid,
    request: CreateWorkflowAttemptRequest,
    workspace_resolver: &W,
) -> Result<WorkflowAttemptResponse, ApiError>
where
    W: WorkflowWorkspaceResolver,
{
    let attempt = create_issue_workflow_attempt(pool, project_id, issue_id, request).await?;
    let workspace_id = workspace_resolver
        .create_or_bind_main_workspace(WorkflowWorkspaceRequest {
            issue_id,
            run_id: attempt.id,
            project_id: Some(project_id),
            existing_workspace_id: None,
            branch_name: main_workflow_branch_name(issue_id, attempt.id),
        })
        .await?;

    let workflow = get_workflow_template(pool, attempt.workflow_id).await?;
    let mut graph: WorkflowGraph = serde_json::from_str(&workflow.graph_json)
        .map_err(|err| ApiError::BadRequest(format!("Invalid workflow graph JSON: {err}")))?;
    if ensure_agent_node_sessions(pool, workspace_id, &mut graph).await? {
        persist_workflow_graph(pool, attempt.workflow_id, &graph).await?;
    }

    update_workflow_attempt_runtime(
        pool,
        attempt.id,
        None,
        Some(workspace_id),
        WorkflowAttemptStatus::Draft,
    )
    .await?;

    workflow_attempt_by_id(pool, attempt.id)
        .await?
        .ok_or_else(|| {
            ApiError::BadRequest("Workflow attempt not found after resource bind".to_string())
        })
}

pub async fn ensure_agent_node_sessions(
    pool: &SqlitePool,
    workspace_id: Uuid,
    graph: &mut WorkflowGraph,
) -> Result<bool, ApiError> {
    let mut changed = false;
    for node in graph
        .nodes
        .iter_mut()
        .filter(|node| node.kind == WorkflowNodeKind::Agent)
    {
        if node.data.session_id.is_some() {
            continue;
        }

        let display_name = node
            .data
            .display_name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(node.id.as_str());
        let session = Session::create(
            pool,
            &CreateSession {
                executor: None,
                name: Some(format!("Workflow {display_name}")),
            },
            Uuid::new_v4(),
            workspace_id,
        )
        .await?;
        node.data.session_id = Some(session.id.to_string());
        changed = true;
    }

    Ok(changed)
}

pub async fn persist_workflow_graph(
    pool: &SqlitePool,
    workflow_id: Uuid,
    graph: &WorkflowGraph,
) -> Result<(), ApiError> {
    validate_graph(graph)
        .map_err(|err| ApiError::BadRequest(format!("Invalid workflow graph: {err}")))?;
    let graph_json = serde_json::to_string(graph)
        .map_err(|err| ApiError::BadRequest(format!("Invalid workflow graph JSON: {err}")))?;

    sqlx::query(
        r#"
        UPDATE workflows
        SET graph_json = ?,
            updated_at = datetime('now', 'subsec')
        WHERE id = ?
        "#,
    )
    .bind(graph_json)
    .bind(workflow_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn list_workflow_attempts_for_issue(
    pool: &SqlitePool,
    project_id: Uuid,
    issue_id: Uuid,
) -> Result<Vec<WorkflowAttemptResponse>, ApiError> {
    ensure_project_exists(pool, project_id).await?;
    ensure_issue_belongs_to_project(pool, project_id, issue_id).await?;

    let rows = sqlx::query(
        r#"
        SELECT id, project_id, issue_id, workflow_id, latest_run_id, workspace_id,
               name, status, created_at, updated_at
        FROM workflow_attempts
        WHERE project_id = ? AND issue_id = ?
        ORDER BY updated_at DESC, created_at DESC
        "#,
    )
    .bind(project_id)
    .bind(issue_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .iter()
        .map(workflow_attempt_from_row)
        .collect::<Result<Vec<_>, _>>()?)
}

pub async fn workflow_attempt_by_id(
    pool: &SqlitePool,
    attempt_id: Uuid,
) -> Result<Option<WorkflowAttemptResponse>, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT id, project_id, issue_id, workflow_id, latest_run_id, workspace_id,
               name, status, created_at, updated_at
        FROM workflow_attempts
        WHERE id = ?
        "#,
    )
    .bind(attempt_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.as_ref().map(workflow_attempt_from_row).transpose()?)
}

pub async fn workflow_attempt_by_workflow_id(
    pool: &SqlitePool,
    workflow_id: Uuid,
) -> Result<Option<WorkflowAttemptResponse>, ApiError> {
    let row = sqlx::query(
        r#"
        SELECT id, project_id, issue_id, workflow_id, latest_run_id, workspace_id,
               name, status, created_at, updated_at
        FROM workflow_attempts
        WHERE workflow_id = ?
        "#,
    )
    .bind(workflow_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.as_ref().map(workflow_attempt_from_row).transpose()?)
}

pub async fn update_workflow_attempt_runtime(
    pool: &SqlitePool,
    attempt_id: Uuid,
    latest_run_id: Option<Uuid>,
    workspace_id: Option<Uuid>,
    status: WorkflowAttemptStatus,
) -> Result<(), ApiError> {
    let result = sqlx::query(
        r#"
        UPDATE workflow_attempts
        SET latest_run_id = COALESCE(?, latest_run_id),
            workspace_id = COALESCE(?, workspace_id),
            status = ?,
            updated_at = datetime('now', 'subsec')
        WHERE id = ?
        "#,
    )
    .bind(latest_run_id)
    .bind(workspace_id)
    .bind(workflow_attempt_status_value(status))
    .bind(attempt_id)
    .execute(pool)
    .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::BadRequest(
            "Workflow attempt not found".to_string(),
        ));
    }

    Ok(())
}

pub async fn run_workflow_attempt_runtime<W, A>(
    pool: &SqlitePool,
    attempt_id: Uuid,
    request: RunWorkflowAttemptRequest,
    workspace_resolver: &W,
    agent_executor: &A,
) -> Result<WorkflowRunResponse, ApiError>
where
    W: WorkflowWorkspaceResolver,
    A: WorkflowAgentExecutor,
{
    let arena_creator = NoopWorkflowArenaCreator;
    run_workflow_attempt_runtime_with_arena(
        pool,
        attempt_id,
        request,
        workspace_resolver,
        agent_executor,
        &arena_creator,
    )
    .await
}

pub async fn run_workflow_attempt_runtime_with_arena<W, A, R>(
    pool: &SqlitePool,
    attempt_id: Uuid,
    request: RunWorkflowAttemptRequest,
    workspace_resolver: &W,
    agent_executor: &A,
    arena_creator: &R,
) -> Result<WorkflowRunResponse, ApiError>
where
    W: WorkflowWorkspaceResolver,
    A: WorkflowAgentExecutor,
    R: WorkflowArenaCreator,
{
    let attempt = workflow_attempt_by_id(pool, attempt_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Workflow attempt not found".to_string()))?;

    let run = trigger_workflow_run_for_attempt_with_arena(
        pool,
        attempt.workflow_id,
        Some(attempt.id),
        TriggerWorkflowRequest {
            issue_id: attempt.issue_id,
            workspace_id: request.workspace_id.or(attempt.workspace_id),
            trigger_source: request.trigger_source,
            input_text: request.input_text,
        },
        workspace_resolver,
        agent_executor,
        arena_creator,
    )
    .await?;

    sync_attempt_from_run(pool, &run).await?;
    get_workflow_run_response(pool, run.id).await
}

pub async fn sync_attempt_from_run(
    pool: &SqlitePool,
    run: &WorkflowRunResponse,
) -> Result<(), ApiError> {
    if let Some(attempt_id) = run.attempt_id {
        update_workflow_attempt_runtime(
            pool,
            attempt_id,
            Some(run.id),
            run.workspace_id,
            workflow_attempt_status_from_run(run.status),
        )
        .await?;
    }
    Ok(())
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

    let graph_json = if let Some(graph_json) = request.graph_json {
        validate_graph_json(&graph_json)?;
        if let Some(workflow_attempt) = workflow_attempt_by_workflow_id(pool, workflow_id).await? {
            if let Some(workspace_id) = workflow_attempt.workspace_id {
                let mut graph: WorkflowGraph =
                    serde_json::from_str(&graph_json).map_err(|err| {
                        ApiError::BadRequest(format!("Invalid workflow graph JSON: {err}"))
                    })?;
                ensure_agent_node_sessions(pool, workspace_id, &mut graph).await?;
                serde_json::to_string(&graph).map_err(|err| {
                    ApiError::BadRequest(format!("Invalid workflow graph JSON: {err}"))
                })?
            } else {
                graph_json
            }
        } else {
            graph_json
        }
    } else {
        existing.graph_json
    };

    sqlx::query(
        r#"
        UPDATE workflows
        SET name = ?, description = ?, graph_json = ?, updated_at = datetime('now', 'subsec')
        WHERE id = ?
        "#,
    )
    .bind(request.name.unwrap_or(existing.name))
    .bind(request.description.or(existing.description))
    .bind(graph_json)
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
        WHERE id NOT IN (SELECT workflow_id FROM workflow_attempts)
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

async fn ensure_issue_belongs_to_project(
    pool: &SqlitePool,
    project_id: Uuid,
    issue_id: Uuid,
) -> Result<(), ApiError> {
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM local_issues WHERE id = ? AND project_id = ?")
            .bind(issue_id)
            .bind(project_id)
            .fetch_one(pool)
            .await?;

    if count == 0 {
        return Err(ApiError::BadRequest(
            "Issue not found for project".to_string(),
        ));
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

fn workflow_attempt_from_row(
    row: &SqliteRow,
) -> Result<WorkflowAttemptResponse, WorkflowRouteError> {
    Ok(WorkflowAttemptResponse {
        id: row.try_get("id")?,
        project_id: row.try_get("project_id")?,
        issue_id: row.try_get("issue_id")?,
        workflow_id: row.try_get("workflow_id")?,
        latest_run_id: row.try_get("latest_run_id")?,
        workspace_id: row.try_get("workspace_id")?,
        name: row.try_get("name")?,
        status: workflow_attempt_status_from_str(&row.try_get::<String, _>("status")?)?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn workflow_run_from_row(row: &SqliteRow) -> Result<WorkflowRunFallbackRow, WorkflowRouteError> {
    Ok(WorkflowRunFallbackRow {
        id: row.try_get("id")?,
        workflow_id: row.try_get("workflow_id")?,
        attempt_id: row.try_get("attempt_id")?,
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
        execution_process_id: row.try_get("execution_process_id")?,
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
        SELECT id, workflow_id, attempt_id, issue_id, workspace_id, trigger_source, input_text,
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
               session_id, execution_process_id, arena_group_id, tokens_used, cost_estimate,
               started_at, finished_at, error_text, created_at, updated_at
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

fn workflow_attempt_status_from_str(
    value: &str,
) -> Result<WorkflowAttemptStatus, WorkflowRouteError> {
    match value {
        "draft" => Ok(WorkflowAttemptStatus::Draft),
        "ready" => Ok(WorkflowAttemptStatus::Ready),
        "running" => Ok(WorkflowAttemptStatus::Running),
        "awaiting_human" => Ok(WorkflowAttemptStatus::AwaitingHuman),
        "awaiting_arena" => Ok(WorkflowAttemptStatus::AwaitingArena),
        "succeeded" => Ok(WorkflowAttemptStatus::Succeeded),
        "failed" => Ok(WorkflowAttemptStatus::Failed),
        "canceled" => Ok(WorkflowAttemptStatus::Canceled),
        other => Err(WorkflowRouteError::BadRequest(format!(
            "Unknown workflow attempt status `{other}`"
        ))),
    }
}

fn workflow_attempt_status_value(status: WorkflowAttemptStatus) -> &'static str {
    match status {
        WorkflowAttemptStatus::Draft => "draft",
        WorkflowAttemptStatus::Ready => "ready",
        WorkflowAttemptStatus::Running => "running",
        WorkflowAttemptStatus::AwaitingHuman => "awaiting_human",
        WorkflowAttemptStatus::AwaitingArena => "awaiting_arena",
        WorkflowAttemptStatus::Succeeded => "succeeded",
        WorkflowAttemptStatus::Failed => "failed",
        WorkflowAttemptStatus::Canceled => "canceled",
    }
}

fn workflow_attempt_status_from_run(status: WorkflowRunStatus) -> WorkflowAttemptStatus {
    match status {
        WorkflowRunStatus::Pending => WorkflowAttemptStatus::Ready,
        WorkflowRunStatus::Running => WorkflowAttemptStatus::Running,
        WorkflowRunStatus::AwaitingHuman => WorkflowAttemptStatus::AwaitingHuman,
        WorkflowRunStatus::AwaitingArena => WorkflowAttemptStatus::AwaitingArena,
        WorkflowRunStatus::Succeeded => WorkflowAttemptStatus::Succeeded,
        WorkflowRunStatus::Failed => WorkflowAttemptStatus::Failed,
        WorkflowRunStatus::Canceled => WorkflowAttemptStatus::Canceled,
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
    let arena_creator = DeploymentWorkflowArenaCreator::new(deployment.clone());
    let data = trigger_workflow_run_with_arena(
        &deployment.db().pool,
        workflow_id,
        request,
        &workspace_resolver,
        &agent_executor,
        &arena_creator,
    )
    .await?;

    Ok(ResponseJson(MutationResponse { data, txid: txid() }))
}

async fn get_workflow_run(
    State(deployment): State<DeploymentImpl>,
    Path(run_id): Path<Uuid>,
) -> Result<ResponseJson<WorkflowRunResponse>, ApiError> {
    let run = get_workflow_run_response(&deployment.db().pool, run_id).await?;
    sync_attempt_from_run(&deployment.db().pool, &run).await?;
    Ok(ResponseJson(run))
}

async fn cancel_workflow_run(
    State(deployment): State<DeploymentImpl>,
    Path(run_id): Path<Uuid>,
) -> Result<ResponseJson<MutationResponse<WorkflowActionResponse>>, ApiError> {
    let canceller = DeploymentWorkflowRunCanceller::new(deployment.clone());
    let run = cancel_workflow_run_runtime(&deployment.db().pool, run_id, &canceller).await?;
    sync_attempt_from_run(&deployment.db().pool, &run).await?;

    Ok(ResponseJson(MutationResponse {
        data: workflow_action_response(&run, None),
        txid: txid(),
    }))
}

async fn workflow_run_events(
    State(deployment): State<DeploymentImpl>,
    Path(run_id): Path<Uuid>,
) -> Result<Sse<impl futures_util::Stream<Item = Result<Event, BoxError>>>, ApiError> {
    let run = get_workflow_run_response(&deployment.db().pool, run_id).await?;
    sync_attempt_from_run(&deployment.db().pool, &run).await?;

    let run_id_string = run_id.to_string();
    let receiver = subscribe_workflow_events();
    let history_events = workflow_event_history(run_id);
    let last_history_sequence = history_events
        .iter()
        .map(|event| event.sequence)
        .max()
        .unwrap_or_default();
    let history = stream::iter(
        history_events
            .into_iter()
            .map(|event| Ok::<Event, BoxError>(workflow_event_to_sse_event(event))),
    );
    let live = stream::unfold(
        (run_id_string, receiver, last_history_sequence),
        |(run_id_string, mut receiver, last_history_sequence)| async move {
            loop {
                match receiver.recv().await {
                    Ok(event)
                        if event.run_id == run_id_string
                            && event.sequence > last_history_sequence =>
                    {
                        return Some((
                            Ok::<Event, BoxError>(workflow_event_to_sse_event(event)),
                            (run_id_string, receiver, last_history_sequence),
                        ));
                    }
                    Ok(_) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
                }
            }
        },
    );

    Ok(Sse::new(history.chain(live)).keep_alive(KeepAlive::default()))
}

async fn retry_node(
    State(deployment): State<DeploymentImpl>,
    Path((run_id, node_id)): Path<(Uuid, String)>,
) -> Result<ResponseJson<MutationResponse<WorkflowActionResponse>>, ApiError> {
    let agent_executor = DeploymentWorkflowAgentExecutor::new(deployment.clone());
    let arena_creator = DeploymentWorkflowArenaCreator::new(deployment.clone());
    let run = retry_workflow_node_with_arena(
        &deployment.db().pool,
        run_id,
        &node_id,
        &agent_executor,
        &arena_creator,
    )
    .await?;
    sync_attempt_from_run(&deployment.db().pool, &run).await?;

    Ok(ResponseJson(MutationResponse {
        data: workflow_action_response(&run, Some(node_id)),
        txid: txid(),
    }))
}

async fn approve_node(
    State(deployment): State<DeploymentImpl>,
    Path((run_id, node_id)): Path<(Uuid, String)>,
) -> Result<ResponseJson<MutationResponse<WorkflowActionResponse>>, ApiError> {
    let agent_executor = DeploymentWorkflowAgentExecutor::new(deployment.clone());
    let arena_creator = DeploymentWorkflowArenaCreator::new(deployment.clone());
    let run = approve_human_node_with_arena(
        &deployment.db().pool,
        run_id,
        &node_id,
        &agent_executor,
        &arena_creator,
    )
    .await?;
    sync_attempt_from_run(&deployment.db().pool, &run).await?;

    Ok(ResponseJson(MutationResponse {
        data: workflow_action_response(&run, Some(node_id)),
        txid: txid(),
    }))
}

async fn reject_node(
    State(deployment): State<DeploymentImpl>,
    Path((run_id, node_id)): Path<(Uuid, String)>,
) -> Result<ResponseJson<MutationResponse<WorkflowActionResponse>>, ApiError> {
    let run = reject_human_node(&deployment.db().pool, run_id, &node_id).await?;
    sync_attempt_from_run(&deployment.db().pool, &run).await?;

    Ok(ResponseJson(MutationResponse {
        data: workflow_action_response(&run, Some(node_id)),
        txid: txid(),
    }))
}

async fn select_arena_winner(
    State(deployment): State<DeploymentImpl>,
    Path((run_id, node_id)): Path<(Uuid, String)>,
    Json(request): Json<SelectArenaWinnerRequest>,
) -> Result<ResponseJson<MutationResponse<WorkflowActionResponse>>, ApiError> {
    let agent_executor = DeploymentWorkflowAgentExecutor::new(deployment.clone());
    let arena_creator = DeploymentWorkflowArenaCreator::new(deployment.clone());
    let winner_applier = DeploymentWorkflowArenaWinnerApplier::new(deployment.clone());
    let run = select_arena_winner_with_arena(
        &deployment.db().pool,
        run_id,
        &node_id,
        request.workspace_id,
        &agent_executor,
        &arena_creator,
        &winner_applier,
    )
    .await?;
    sync_attempt_from_run(&deployment.db().pool, &run).await?;

    Ok(ResponseJson(MutationResponse {
        data: workflow_action_response(&run, Some(node_id)),
        txid: txid(),
    }))
}

fn workflow_action_response(
    run: &WorkflowRunResponse,
    node_id: Option<String>,
) -> WorkflowActionResponse {
    WorkflowActionResponse {
        run_id: run.id,
        node_id,
        status: run.status,
    }
}

fn workflow_event_to_sse_event(event: workflow::WorkflowEvent) -> Event {
    let event_name = serde_json::to_string(&event.kind)
        .ok()
        .and_then(|value| serde_json::from_str::<String>(&value).ok())
        .unwrap_or_else(|| "workflow_event".to_string());
    let id = event.sequence.to_string();
    let data = serde_json::to_string(&event).unwrap_or_else(|_| "{}".to_string());

    Event::default().id(id).event(event_name).data(data)
}
