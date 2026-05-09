use axum::{
    Json, Router,
    extract::Path,
    http::StatusCode,
    response::Json as ResponseJson,
    routing::{get, post},
};
use chrono::{DateTime, Utc};
use db::models::workflow::{NodeExecutionStatus, WorkflowRunStatus, WorkflowSource};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::DeploymentImpl;

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
    Path(_project_id): Path<Uuid>,
) -> ResponseJson<WorkflowTemplateListResponse> {
    ResponseJson(WorkflowTemplateListResponse {
        workflows: Vec::new(),
    })
}

async fn create_workflow(
    Path(_project_id): Path<Uuid>,
    Json(_request): Json<CreateWorkflowRequest>,
) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn get_workflow(Path(_workflow_id): Path<Uuid>) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn update_workflow(
    Path(_workflow_id): Path<Uuid>,
    Json(_request): Json<UpdateWorkflowRequest>,
) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn delete_workflow(Path(_workflow_id): Path<Uuid>) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn trigger_workflow(
    Path(_workflow_id): Path<Uuid>,
    Json(_request): Json<TriggerWorkflowRequest>,
) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

async fn get_workflow_run(Path(_run_id): Path<Uuid>) -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
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
