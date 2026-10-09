use api_types::{
    CreateTaskRelationshipRequest, ListTaskRelationshipsQuery, ListTaskRelationshipsResponse,
    MutationResponse, TaskRelationship,
};
use axum::{
    Router,
    extract::{Json, Path, Query, State},
    response::Json as ResponseJson,
    routing::get,
};
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

pub(super) fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route(
            "/task-relationships",
            get(list_issue_relationships).post(create_issue_relationship),
        )
        .route(
            "/task-relationships/{relationship_id}",
            axum::routing::delete(delete_issue_relationship),
        )
}

async fn list_issue_relationships(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ListTaskRelationshipsQuery>,
) -> Result<ResponseJson<ApiResponse<ListTaskRelationshipsResponse>>, ApiError> {
    let client = deployment.remote_client()?;
    let response = client.list_issue_relationships(query.issue_id).await?;
    Ok(ResponseJson(ApiResponse::success(response)))
}

async fn create_issue_relationship(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateTaskRelationshipRequest>,
) -> Result<ResponseJson<ApiResponse<MutationResponse<TaskRelationship>>>, ApiError> {
    let client = deployment.remote_client()?;
    let response = client.create_issue_relationship(&request).await?;
    Ok(ResponseJson(ApiResponse::success(response)))
}

async fn delete_issue_relationship(
    State(deployment): State<DeploymentImpl>,
    Path(relationship_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let client = deployment.remote_client()?;
    client.delete_issue_relationship(relationship_id).await?;
    Ok(ResponseJson(ApiResponse::success(())))
}
