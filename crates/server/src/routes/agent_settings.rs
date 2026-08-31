use std::path::Path;

use axum::{
    Json, Router,
    extract::{Query, State},
    response::Json as ResponseJson,
    routing::{get, post},
};
use executors::agent_settings::{
    AgentSettingOperationError, AgentSettingsInventory, AgentSettingsProvider,
    AgentSettingsService, ApplyConfigProfileRequest, ApplyNativeFileRequest, ApplySettingsRequest,
    ConfigProfile, CopyProfilePreviewRequest, DeleteConfigProfileRequest,
    DuplicateConfigProfileRequest, NativeFilePatch, ProfileApplyPreviewRequest, ProfileCopyPreview,
    RevealAgentSettingRequest, RevealAgentSettingResponse, SaveConfigProfileRequest, SettingsDiff,
    SettingsPatch, SettingsSnapshot,
};
use serde::Deserialize;
use ts_rs::TS;
use utils::response::ApiResponse;

use crate::DeploymentImpl;

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/agent-settings", get(discover))
        .route("/agent-settings/diff", post(diff))
        .route("/agent-settings/apply", post(apply))
        .route("/agent-settings/reveal", post(reveal))
        .route("/agent-settings/native-file/diff", post(diff_native_file))
        .route("/agent-settings/native-file/apply", post(apply_native_file))
        .route(
            "/agent-settings/profiles",
            get(list_profiles).post(save_profile).put(save_profile),
        )
        .route("/agent-settings/profiles/delete", post(delete_profile))
        .route(
            "/agent-settings/profiles/duplicate",
            post(duplicate_profile),
        )
        .route(
            "/agent-settings/profiles/copy-preview",
            post(copy_profile_preview),
        )
        .route(
            "/agent-settings/profiles/apply-preview",
            post(profile_apply_preview),
        )
        .route("/agent-settings/profiles/apply", post(apply_profile))
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct AgentSettingsDiscoveryQuery {
    #[serde(default)]
    pub provider: Option<AgentSettingsProvider>,
    #[serde(default)]
    pub project_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct AgentSettingsProfilesQuery {
    #[serde(default)]
    pub provider: Option<AgentSettingsProvider>,
}

fn service() -> Result<AgentSettingsService, AgentSettingOperationError> {
    AgentSettingsService::from_system().map_err(|error| error.operation_error(None, None, None))
}

fn operation_error(
    error: executors::agent_settings::AgentSettingError,
    provider: Option<AgentSettingsProvider>,
) -> AgentSettingOperationError {
    error.operation_error(provider, None, None)
}

async fn discover(
    State(_deployment): State<DeploymentImpl>,
    Query(query): Query<AgentSettingsDiscoveryQuery>,
) -> ResponseJson<ApiResponse<AgentSettingsInventory, AgentSettingOperationError>> {
    match service() {
        Ok(service) => ResponseJson(ApiResponse::success(
            service.discover(query.provider, query.project_path.as_deref().map(Path::new)),
        )),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn diff(
    State(_deployment): State<DeploymentImpl>,
    Json(patch): Json<SettingsPatch>,
) -> ResponseJson<ApiResponse<SettingsDiff, AgentSettingOperationError>> {
    let provider = patch.provider;
    match service().and_then(|service| {
        service
            .diff(&patch)
            .map_err(|error| operation_error(error, Some(provider)))
    }) {
        Ok(diff) => ResponseJson(ApiResponse::success(diff)),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn apply(
    State(_deployment): State<DeploymentImpl>,
    Json(request): Json<ApplySettingsRequest>,
) -> ResponseJson<ApiResponse<SettingsSnapshot, AgentSettingOperationError>> {
    let provider = request.patch.provider;
    match service().and_then(|service| {
        service
            .apply(request)
            .map_err(|error| operation_error(error, Some(provider)))
    }) {
        Ok(snapshot) => ResponseJson(ApiResponse::success(snapshot)),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn reveal(
    State(_deployment): State<DeploymentImpl>,
    Json(request): Json<RevealAgentSettingRequest>,
) -> ResponseJson<ApiResponse<RevealAgentSettingResponse, AgentSettingOperationError>> {
    let provider = request.provider;
    match service().and_then(|service| {
        service
            .reveal(request)
            .map_err(|error| operation_error(error, Some(provider)))
    }) {
        Ok(response) => ResponseJson(ApiResponse::success(response)),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn diff_native_file(
    State(_deployment): State<DeploymentImpl>,
    Json(patch): Json<NativeFilePatch>,
) -> ResponseJson<ApiResponse<SettingsDiff, AgentSettingOperationError>> {
    let provider = patch.provider;
    match service().and_then(|service| {
        service
            .diff_native_file(&patch)
            .map_err(|error| operation_error(error, Some(provider)))
    }) {
        Ok(diff) => ResponseJson(ApiResponse::success(diff)),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn apply_native_file(
    State(_deployment): State<DeploymentImpl>,
    Json(request): Json<ApplyNativeFileRequest>,
) -> ResponseJson<ApiResponse<SettingsSnapshot, AgentSettingOperationError>> {
    let provider = request.patch.provider;
    match service().and_then(|service| {
        service
            .apply_native_file(request)
            .map_err(|error| operation_error(error, Some(provider)))
    }) {
        Ok(snapshot) => ResponseJson(ApiResponse::success(snapshot)),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn list_profiles(
    State(_deployment): State<DeploymentImpl>,
    Query(query): Query<AgentSettingsProfilesQuery>,
) -> ResponseJson<ApiResponse<Vec<ConfigProfile>, AgentSettingOperationError>> {
    match service().and_then(|service| {
        service
            .list_profiles(query.provider)
            .map_err(|error| operation_error(error, query.provider))
    }) {
        Ok(profiles) => ResponseJson(ApiResponse::success(profiles)),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn save_profile(
    State(_deployment): State<DeploymentImpl>,
    Json(request): Json<SaveConfigProfileRequest>,
) -> ResponseJson<ApiResponse<ConfigProfile, AgentSettingOperationError>> {
    let provider = request.profile.provider;
    match service().and_then(|service| {
        service
            .save_profile(request)
            .map_err(|error| operation_error(error, Some(provider)))
    }) {
        Ok(profile) => ResponseJson(ApiResponse::success(profile)),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn delete_profile(
    State(_deployment): State<DeploymentImpl>,
    Json(request): Json<DeleteConfigProfileRequest>,
) -> ResponseJson<ApiResponse<(), AgentSettingOperationError>> {
    match service().and_then(|service| {
        service
            .delete_profile(request)
            .map_err(|error| operation_error(error, None))
    }) {
        Ok(()) => ResponseJson(ApiResponse::success(())),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn duplicate_profile(
    State(_deployment): State<DeploymentImpl>,
    Json(request): Json<DuplicateConfigProfileRequest>,
) -> ResponseJson<ApiResponse<ConfigProfile, AgentSettingOperationError>> {
    match service().and_then(|service| {
        service
            .duplicate_profile(request)
            .map_err(|error| operation_error(error, None))
    }) {
        Ok(profile) => ResponseJson(ApiResponse::success(profile)),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn copy_profile_preview(
    State(_deployment): State<DeploymentImpl>,
    Json(request): Json<CopyProfilePreviewRequest>,
) -> ResponseJson<ApiResponse<ProfileCopyPreview, AgentSettingOperationError>> {
    let provider = request.target_provider;
    match service().and_then(|service| {
        service
            .copy_profile_preview(request)
            .map_err(|error| operation_error(error, Some(provider)))
    }) {
        Ok(preview) => ResponseJson(ApiResponse::success(preview)),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn profile_apply_preview(
    State(_deployment): State<DeploymentImpl>,
    Json(request): Json<ProfileApplyPreviewRequest>,
) -> ResponseJson<ApiResponse<SettingsDiff, AgentSettingOperationError>> {
    match service().and_then(|service| {
        service
            .preview_profile_apply(&request)
            .map_err(|error| operation_error(error, None))
    }) {
        Ok(preview) => ResponseJson(ApiResponse::success(preview)),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}

async fn apply_profile(
    State(_deployment): State<DeploymentImpl>,
    Json(request): Json<ApplyConfigProfileRequest>,
) -> ResponseJson<ApiResponse<SettingsSnapshot, AgentSettingOperationError>> {
    match service().and_then(|service| {
        service
            .apply_profile(request)
            .map_err(|error| operation_error(error, None))
    }) {
        Ok(snapshot) => ResponseJson(ApiResponse::success(snapshot)),
        Err(error) => ResponseJson(ApiResponse::error_with_data(error)),
    }
}
