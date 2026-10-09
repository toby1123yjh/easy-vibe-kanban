use api_types::{
    CreateTaskAssigneeRequest, ListTaskAssigneesResponse, MutationResponse, TaskAssignee,
};
use axum::{
    Router,
    extract::{Json, Path, Query, State},
    response::Json as ResponseJson,
    routing::get,
};
use serde::Deserialize;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize)]
pub(super) struct ListTaskAssigneesQuery {
    #[serde(rename = "task_id")]
    pub issue_id: Uuid,
}

pub(super) fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route(
            "/task-assignees",
            get(list_issue_assignees).post(create_issue_assignee),
        )
        .route(
            "/task-assignees/{issue_assignee_id}",
            get(get_issue_assignee).delete(delete_issue_assignee),
        )
}

async fn list_issue_assignees(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ListTaskAssigneesQuery>,
) -> Result<ResponseJson<ApiResponse<ListTaskAssigneesResponse>>, ApiError> {
    let client = deployment.remote_client()?;
    let response = client.list_issue_assignees(query.issue_id).await?;
    Ok(ResponseJson(ApiResponse::success(response)))
}

async fn get_issue_assignee(
    State(deployment): State<DeploymentImpl>,
    Path(issue_assignee_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<TaskAssignee>>, ApiError> {
    let client = deployment.remote_client()?;
    let response = client.get_issue_assignee(issue_assignee_id).await?;
    Ok(ResponseJson(ApiResponse::success(response)))
}

async fn create_issue_assignee(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateTaskAssigneeRequest>,
) -> Result<ResponseJson<ApiResponse<MutationResponse<TaskAssignee>>>, ApiError> {
    let client = deployment.remote_client()?;
    let response = client.create_issue_assignee(&request).await?;
    Ok(ResponseJson(ApiResponse::success(response)))
}

async fn delete_issue_assignee(
    State(deployment): State<DeploymentImpl>,
    Path(issue_assignee_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let client = deployment.remote_client()?;
    client.delete_issue_assignee(issue_assignee_id).await?;
    Ok(ResponseJson(ApiResponse::success(())))
}
