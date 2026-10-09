//! Scoped external API. Deployments must expose only /api/integrations/v1 to
//! external callers; the existing local management API is not key-protected.
use axum::{
    Json, Router,
    extract::{Path, Request, State},
    http::{HeaderMap, header},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use db::models::{integration::ExternalIntegration, project::DEFAULT_PROJECT_ID};
use deployment::Deployment;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::SqlitePool;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

pub mod files;
mod projects;
pub mod workflows;
pub use projects::{CreateExternalProject, CreateExternalTask, project_root};

#[derive(Debug, Clone)]
pub struct IntegrationCaller {
    pub id: Uuid,
}

#[derive(Debug, Serialize, TS)]
pub struct IntegrationSettings {
    #[serde(flatten)]
    pub integration: ExternalIntegration,
    pub project_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CreateIntegrationRequest {
    pub name: String,
    pub project_ids: Vec<Uuid>,
}

#[derive(Debug, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct UpdateIntegrationRequest {
    pub name: String,
    pub enabled: bool,
    pub project_ids: Vec<Uuid>,
    pub expected_project_ids: Vec<Uuid>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SetIntegrationEnabledRequest {
    enabled: bool,
}

// Do not derive Debug: the key is deliberately returned only once.
#[derive(Serialize, TS)]
pub struct CreatedIntegration {
    pub integration: IntegrationSettings,
    pub api_key: String,
}

#[derive(Debug, Serialize, sqlx::FromRow, TS)]
pub struct IntegrationProjectOption {
    pub id: Uuid,
    pub name: String,
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    Router::new()
        .merge(projects::router())
        .merge(files::router())
        .merge(workflows::router())
        .layer(axum::middleware::from_fn_with_state(
            deployment.clone(),
            authenticate,
        ))
        .layer(axum::middleware::from_fn(external_error_contract))
}

/// Normalize extractor failures and business failures alike. The local API's
/// envelope is retained, while external clients receive a stable machine code.
async fn external_error_contract(request: Request, next: Next) -> Response {
    let response = next.run(request).await;
    normalize_error_response(response).await
}

async fn normalize_error_response(response: Response) -> Response {
    let status = response.status();
    if !status.is_client_error() && !status.is_server_error() {
        return response;
    }
    let bytes = axum::body::to_bytes(response.into_body(), 65_536)
        .await
        .unwrap_or_default();
    let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::Value::Null);
    // Shared workflow handlers already map their errors to safe, structured
    // codes. Preserve that contract instead of erasing it as generic conflict.
    if let Some(error_data) = body.get("error_data")
        && let (Some(code), Some(message)) = (
            error_data.get("code").and_then(serde_json::Value::as_str),
            error_data
                .get("message")
                .and_then(serde_json::Value::as_str),
        )
    {
        return (
            status,
            Json(serde_json::json!({"success": false, "data": null,
                "error_data": {"code": code, "message": message}, "message": message})),
        )
            .into_response();
    }
    let message = if status.is_server_error() {
        "The operation failed. Retry with the same Idempotency-Key.".to_owned()
    } else {
        body.get("message")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| String::from_utf8_lossy(&bytes).into_owned())
    };
    let code = if message.contains("IDEMPOTENCY_CONFLICT:") {
        "idempotency_conflict"
    } else if message.contains("FILE_EXISTS:") {
        "file_exists"
    } else if message.contains("PROJECT_SPACE_REQUIRED:") {
        "project_space_required"
    } else {
        match status.as_u16() {
            401 => "unauthorized",
            403 => "forbidden",
            404 => "not_found",
            409 => "conflict",
            413 => "payload_too_large",
            429 => "too_many_requests",
            500..=599 => "internal_error",
            _ => "invalid_request",
        }
    };
    (
        status,
        Json(serde_json::json!({"success": false, "data": null,
        "error_data": {"code": code, "message": message}, "message": message})),
    )
        .into_response()
}

pub fn admin_router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/integration-settings", get(list).post(create))
        .route("/integration-settings/projects", get(project_options))
        .route("/integration-settings/{id}", post(update))
        .route("/integration-settings/{id}/enabled", post(set_enabled))
}

async fn authenticate(
    State(deployment): State<DeploymentImpl>,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    let caller = authenticate_headers(&deployment.db().pool, request.headers()).await?;
    request.extensions_mut().insert(caller);
    Ok(next.run(request).await)
}

async fn authenticate_headers(
    pool: &SqlitePool,
    headers: &HeaderMap,
) -> Result<IntegrationCaller, ApiError> {
    let key = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split_once(' '))
        .filter(|(scheme, _)| scheme.eq_ignore_ascii_case("bearer"))
        .map(|(_, key)| key)
        .filter(|key| key.starts_with("vk_ext_") && key.len() == 71)
        .ok_or(ApiError::Unauthorized)?;
    let id = ExternalIntegration::authenticate(pool, &digest(key.as_bytes()))
        .await?
        .ok_or(ApiError::Unauthorized)?;
    Ok(IntegrationCaller { id })
}

pub async fn authorize_project(
    pool: &SqlitePool,
    caller: &IntegrationCaller,
    project_id: Uuid,
) -> Result<(), ApiError> {
    if project_id == DEFAULT_PROJECT_ID
        || !ExternalIntegration::is_authorized(pool, caller.id, project_id).await?
    {
        return Err(ApiError::Forbidden(
            "Project is not authorized for this integration".into(),
        ));
    }
    Ok(())
}

pub fn request_key(headers: &HeaderMap) -> Result<String, ApiError> {
    headers
        .get("Idempotency-Key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.trim().is_empty() && value.len() <= 200)
        .map(str::to_owned)
        .ok_or_else(|| {
            ApiError::BadRequest("Idempotency-Key is required (1–200 characters)".into())
        })
}

pub fn request_hash(request: &impl Serialize) -> Result<String, ApiError> {
    // This workspace enables preserve_order; sort recursively rather than
    // accidentally treating equivalent JSON field ordering as new parameters.
    let mut value = serde_json::to_value(request)
        .map_err(|_| ApiError::BadRequest("Invalid request".into()))?;
    value.sort_all_objects();
    let bytes =
        serde_json::to_vec(&value).map_err(|_| ApiError::BadRequest("Invalid request".into()))?;
    Ok(digest(&bytes))
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

async fn settings(
    pool: &SqlitePool,
    integration: ExternalIntegration,
) -> Result<IntegrationSettings, ApiError> {
    let project_ids = ExternalIntegration::project_ids(pool, integration.id).await?;
    Ok(IntegrationSettings {
        integration,
        project_ids,
    })
}

async fn list(
    State(deployment): State<DeploymentImpl>,
) -> Result<Json<ApiResponse<Vec<IntegrationSettings>>>, ApiError> {
    let pool = &deployment.db().pool;
    let mut items = Vec::new();
    for integration in ExternalIntegration::list(pool).await? {
        items.push(settings(pool, integration).await?);
    }
    Ok(Json(ApiResponse::success(items)))
}

fn validate_name(name: &str) -> Result<&str, ApiError> {
    let name = name.trim();
    if name.is_empty() || name.len() > 200 {
        return Err(ApiError::BadRequest("Name must contain 1–200 bytes".into()));
    }
    Ok(name)
}

async fn replace_grants(
    conn: &mut sqlx::SqliteConnection,
    id: Uuid,
    projects: &[Uuid],
) -> Result<(), ApiError> {
    for project_id in projects {
        let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM projects WHERE id = ?)")
            .bind(project_id)
            .fetch_one(&mut *conn)
            .await?;
        if !exists || *project_id == DEFAULT_PROJECT_ID {
            return Err(ApiError::BadRequest(
                "Select an existing ordinary project".into(),
            ));
        }
    }
    sqlx::query("DELETE FROM external_integration_projects WHERE integration_id = ?")
        .bind(id)
        .execute(&mut *conn)
        .await?;
    for project_id in projects {
        sqlx::query("INSERT OR IGNORE INTO external_integration_projects (integration_id, project_id) VALUES (?, ?)")
            .bind(id).bind(project_id).execute(&mut *conn).await?;
    }
    Ok(())
}

async fn create(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CreateIntegrationRequest>,
) -> Result<Json<ApiResponse<CreatedIntegration>>, ApiError> {
    let name = validate_name(&request.name)?;
    let mut secret = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut secret);
    let api_key = format!(
        "vk_ext_{}",
        secret
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    let id = Uuid::new_v4();
    let pool = &deployment.db().pool;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let integration = sqlx::query_as::<_, ExternalIntegration>("INSERT INTO external_integrations (id, name, key_digest) VALUES (?, ?, ?) RETURNING id, name, enabled, created_at")
        .bind(id).bind(name).bind(digest(api_key.as_bytes())).fetch_one(&mut *tx).await?;
    replace_grants(&mut tx, id, &request.project_ids).await?;
    tx.commit().await?;
    Ok(Json(ApiResponse::success(CreatedIntegration {
        integration: settings(pool, integration).await?,
        api_key,
    })))
}

async fn update(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<Uuid>,
    Json(request): Json<UpdateIntegrationRequest>,
) -> Result<Json<ApiResponse<IntegrationSettings>>, ApiError> {
    let name = validate_name(&request.name)?;
    let pool = &deployment.db().pool;
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    ensure_current_grants(&mut tx, id, &request.expected_project_ids).await?;
    let integration = sqlx::query_as::<_, ExternalIntegration>("UPDATE external_integrations SET name = ?, enabled = ? WHERE id = ? RETURNING id, name, enabled, created_at")
        .bind(name).bind(request.enabled).bind(id).fetch_optional(&mut *tx).await?
        .ok_or_else(|| ApiError::BadRequest("Integration not found".into()))?;
    replace_grants(&mut tx, id, &request.project_ids).await?;
    tx.commit().await?;
    Ok(Json(ApiResponse::success(
        settings(pool, integration).await?,
    )))
}

async fn ensure_current_grants(
    conn: &mut sqlx::SqliteConnection,
    id: Uuid,
    expected: &[Uuid],
) -> Result<(), ApiError> {
    let actual: Vec<Uuid> = sqlx::query_scalar(
        "SELECT project_id FROM external_integration_projects WHERE integration_id = ?",
    )
    .bind(id)
    .fetch_all(conn)
    .await?;
    let actual: std::collections::BTreeSet<_> = actual.into_iter().collect();
    let expected: std::collections::BTreeSet<_> = expected.iter().copied().collect();
    if actual != expected {
        return Err(ApiError::Conflict(
            "Project access changed while editing. Cancel this edit and reopen it to load the current grants.".into(),
        ));
    }
    Ok(())
}

async fn set_enabled(
    State(deployment): State<DeploymentImpl>,
    Path(id): Path<Uuid>,
    Json(request): Json<SetIntegrationEnabledRequest>,
) -> Result<Json<ApiResponse<IntegrationSettings>>, ApiError> {
    Ok(Json(ApiResponse::success(
        set_integration_enabled(&deployment.db().pool, id, request.enabled).await?,
    )))
}

async fn set_integration_enabled(
    pool: &SqlitePool,
    id: Uuid,
    enabled: bool,
) -> Result<IntegrationSettings, ApiError> {
    // Availability changes must not replace grants from a stale settings list:
    // an external caller may have auto-granted a new project in the meantime.
    let integration = sqlx::query_as::<_, ExternalIntegration>(
        "UPDATE external_integrations SET enabled = ? WHERE id = ? RETURNING id, name, enabled, created_at",
    )
    .bind(enabled)
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::BadRequest("Integration not found".into()))?;
    settings(pool, integration).await
}

async fn project_options(
    State(deployment): State<DeploymentImpl>,
) -> Result<Json<ApiResponse<Vec<IntegrationProjectOption>>>, ApiError> {
    let projects =
        sqlx::query_as("SELECT id, name FROM projects WHERE id <> ? ORDER BY updated_at DESC, id")
            .bind(DEFAULT_PROJECT_ID)
            .fetch_all(&deployment.db().pool)
            .await?;
    Ok(Json(ApiResponse::success(projects)))
}

#[cfg(test)]
mod tests {
    use axum::{
        body::to_bytes,
        http::{HeaderValue, StatusCode},
    };

    use super::*;

    #[tokio::test]
    async fn availability_changes_preserve_new_grants_and_reject_unknown_fields() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE projects (id BLOB PRIMARY KEY)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::raw_sql(include_str!(
            "../../../../db/migrations/20260929000000_external_integrations.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        let id = Uuid::new_v4();
        let project_id = Uuid::new_v4();
        sqlx::query("INSERT INTO external_integrations (id, name, key_digest) VALUES (?, 'current name', 'digest')")
            .bind(id).execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO projects (id) VALUES (?)")
            .bind(project_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO external_integration_projects VALUES (?, ?)")
            .bind(id)
            .bind(project_id)
            .execute(&pool)
            .await
            .unwrap();
        for enabled in [false, true] {
            let settings = set_integration_enabled(&pool, id, enabled).await.unwrap();
            assert_eq!(settings.integration.enabled, enabled);
            assert_eq!(settings.integration.name, "current name");
            assert_eq!(settings.project_ids, vec![project_id]);
        }
        let mut tx = pool.begin_with("BEGIN IMMEDIATE").await.unwrap();
        assert!(matches!(
            ensure_current_grants(&mut tx, id, &[]).await,
            Err(ApiError::Conflict(_))
        ));
        ensure_current_grants(&mut tx, id, &[project_id])
            .await
            .unwrap();
        tx.rollback().await.unwrap();
        assert!(
            serde_json::from_value::<SetIntegrationEnabledRequest>(
                serde_json::json!({"enabled": false, "project_ids": []})
            )
            .is_err()
        );
        assert!(
            set_integration_enabled(&pool, Uuid::new_v4(), false)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn authentication_has_no_local_bypass_and_rechecks_enabled_state() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::raw_sql(include_str!(
            "../../../../db/migrations/20260929000000_external_integrations.sql"
        ))
        .execute(&pool)
        .await
        .unwrap();
        let raw_key = format!("vk_ext_{}", "a".repeat(64));
        let id = Uuid::new_v4();
        sqlx::query(
            "INSERT INTO external_integrations (id, name, key_digest) VALUES (?, 'client', ?)",
        )
        .bind(id)
        .bind(digest(raw_key.as_bytes()))
        .execute(&pool)
        .await
        .unwrap();
        let mut headers = HeaderMap::new();
        assert!(matches!(
            authenticate_headers(&pool, &headers).await,
            Err(ApiError::Unauthorized)
        ));
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_str(&format!("bearer {raw_key}")).unwrap(),
        );
        assert_eq!(authenticate_headers(&pool, &headers).await.unwrap().id, id);
        sqlx::query("UPDATE external_integrations SET enabled = 0 WHERE id = ?")
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        assert!(matches!(
            authenticate_headers(&pool, &headers).await,
            Err(ApiError::Unauthorized)
        ));
        let stored: String =
            sqlx::query_scalar("SELECT key_digest FROM external_integrations WHERE id = ?")
                .bind(id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_ne!(stored, raw_key);
    }

    #[tokio::test]
    async fn external_errors_have_stable_codes_and_do_not_leak_internal_paths() {
        for (error, status, code) in [
            (
                ApiError::Unauthorized,
                StatusCode::UNAUTHORIZED,
                "unauthorized",
            ),
            (
                ApiError::Conflict("FILE_EXISTS: Explicit overwrite is required".into()),
                StatusCode::CONFLICT,
                "file_exists",
            ),
            (
                ApiError::Io(std::io::Error::other("private /server/root secret")),
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
            ),
        ] {
            let response = normalize_error_response(error.into_response()).await;
            assert_eq!(response.status(), status);
            let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();
            let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body["error_data"]["code"], code);
            assert!(!String::from_utf8_lossy(&bytes).contains("/server/root"));
        }
    }

    #[tokio::test]
    async fn external_errors_preserve_shared_workflow_codes_and_safe_messages() {
        use crate::routes::workflow_management::WorkflowManagementApiError;

        for (error, status, code) in [
            (
                ApiError::Conflict("REUSE_UNAVAILABLE: The source result is missing".into()),
                StatusCode::CONFLICT,
                "reuse_unavailable",
            ),
            (
                ApiError::BadRequest("INVALID_REWORK_SCOPE: Select an Agent Node".into()),
                StatusCode::BAD_REQUEST,
                "invalid_rework_scope",
            ),
            (
                ApiError::Io(std::io::Error::other("private /server/root secret")),
                StatusCode::INTERNAL_SERVER_ERROR,
                "workflow_unavailable",
            ),
        ] {
            let response =
                normalize_error_response(WorkflowManagementApiError(error).into_response()).await;
            assert_eq!(response.status(), status);
            let bytes = to_bytes(response.into_body(), 65_536).await.unwrap();
            let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body["error_data"]["code"], code);
            assert_eq!(body["error_data"]["message"], body["message"]);
            assert!(!String::from_utf8_lossy(&bytes).contains("/server/root"));
        }
    }

    #[test]
    fn request_hash_is_order_independent_and_payload_sensitive() {
        let a: serde_json::Value =
            serde_json::from_str(r#"{"name":"hello","config":{"a":1,"b":2}}"#).unwrap();
        let b: serde_json::Value =
            serde_json::from_str(r#"{"config":{"b":2,"a":1},"name":"hello"}"#).unwrap();
        assert_eq!(request_hash(&a).unwrap(), request_hash(&b).unwrap());
        assert_ne!(
            request_hash(&a).unwrap(),
            request_hash(&serde_json::json!({"name":"different"})).unwrap()
        );
        assert!(request_key(&HeaderMap::new()).is_err());
    }
}
