use std::path::Path;

use axum::{
    Json, Router,
    extract::{Query, State},
    response::Json as ResponseJson,
    routing::{get, post},
};
use executors::agent_commands::{
    AgentCommandInventoryView, AgentCommandLocator, AgentCommandOperationError,
    AgentCommandService, AgentCommandView, CreateAgentCommandRequest, RemoveAgentCommandRequest,
    ToggleAgentCommandRequest, UpdateAgentCommandRequest,
};
use serde::Deserialize;
use ts_rs::TS;
use utils::response::ApiResponse;

use crate::DeploymentImpl;

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/agent-commands", get(discover).post(create).put(update))
        .route("/agent-commands/remove", post(remove))
        .route("/agent-commands/toggle", post(toggle))
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct AgentCommandDiscoveryQuery {
    #[serde(default)]
    pub project_path: Option<String>,
}

fn service() -> Result<AgentCommandService, AgentCommandOperationError> {
    AgentCommandService::from_system().map_err(|error| error.operation_error(None, None))
}

fn operation_error(
    error: executors::agent_commands::AgentCommandError,
    locator: &AgentCommandLocator,
) -> AgentCommandOperationError {
    error.operation_error(Some(locator.provider), Some(locator.name.clone()))
}

async fn discover(
    State(_deployment): State<DeploymentImpl>,
    Query(query): Query<AgentCommandDiscoveryQuery>,
) -> ResponseJson<ApiResponse<AgentCommandInventoryView, AgentCommandOperationError>> {
    match service() {
        Ok(service) => ResponseJson(ApiResponse::success(
            service.discover(query.project_path.as_deref().map(Path::new)),
        )),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn create(
    State(_deployment): State<DeploymentImpl>,
    Json(request): Json<CreateAgentCommandRequest>,
) -> ResponseJson<ApiResponse<AgentCommandView, AgentCommandOperationError>> {
    let locator = request.target.clone();
    match service().and_then(|service| {
        service
            .create(request)
            .map_err(|error| operation_error(error, &locator))
    }) {
        Ok(item) => ResponseJson(ApiResponse::success(item)),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn update(
    State(_deployment): State<DeploymentImpl>,
    Json(request): Json<UpdateAgentCommandRequest>,
) -> ResponseJson<ApiResponse<AgentCommandView, AgentCommandOperationError>> {
    let locator = request.target.clone();
    match service().and_then(|service| {
        service
            .update(request)
            .map_err(|error| operation_error(error, &locator))
    }) {
        Ok(item) => ResponseJson(ApiResponse::success(item)),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn remove(
    State(_deployment): State<DeploymentImpl>,
    Json(request): Json<RemoveAgentCommandRequest>,
) -> ResponseJson<ApiResponse<(), AgentCommandOperationError>> {
    let locator = request.target.clone();
    match service().and_then(|service| {
        service
            .remove(request)
            .map_err(|error| operation_error(error, &locator))
    }) {
        Ok(()) => ResponseJson(ApiResponse::success(())),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn toggle(
    State(_deployment): State<DeploymentImpl>,
    Json(request): Json<ToggleAgentCommandRequest>,
) -> ResponseJson<ApiResponse<AgentCommandView, AgentCommandOperationError>> {
    let locator = request.target.clone();
    match service().and_then(|service| {
        service
            .set_enabled(request)
            .map_err(|error| operation_error(error, &locator))
    }) {
        Ok(item) => ResponseJson(ApiResponse::success(item)),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}
