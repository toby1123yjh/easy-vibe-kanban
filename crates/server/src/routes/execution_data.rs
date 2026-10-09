use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use chrono::{DateTime, Utc};
use db::models::{
    project::{Project, ProjectCursor, ProjectPage},
    session::{Session, SessionCursor, SessionPage},
    task::{Execution, ExecutionCursor, ExecutionError, ExecutionSummary, ExecutionSummaryPage},
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum ExecutionDataOwner {
    LocalHost,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ExecutionDataCapabilities {
    pub owner: ExecutionDataOwner,
    #[serde(rename = "execution_queries")]
    #[ts(rename = "execution_queries")]
    pub task_queries: bool,
    pub execution_actions: bool,
}

#[derive(Debug, Deserialize)]
pub struct ProjectListQuery {
    pub cursor_updated_at: Option<DateTime<Utc>>,
    pub cursor_id: Option<Uuid>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct SessionListQuery {
    pub project_id: Option<Uuid>,
    pub cursor_updated_at: Option<DateTime<Utc>>,
    pub cursor_id: Option<Uuid>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct ExecutionListQuery {
    pub project_id: Uuid,
    #[serde(rename = "task_id")]
    pub issue_id: Option<Uuid>,
    pub cursor_updated_at: Option<DateTime<Utc>>,
    pub cursor_id: Option<Uuid>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct ExecutionChildrenQuery {
    pub cursor_updated_at: Option<DateTime<Utc>>,
    pub cursor_id: Option<Uuid>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct DeleteExecutionQuery {
    #[serde(default)]
    pub stop_running: bool,
    #[serde(default)]
    pub delete_managed_files: bool,
    pub session_id: Uuid,
}

fn cursor_parts(
    updated_at: Option<DateTime<Utc>>,
    id: Option<Uuid>,
) -> Result<Option<(DateTime<Utc>, Uuid)>, ApiError> {
    match (updated_at, id) {
        (None, None) => Ok(None),
        (Some(updated_at), Some(id)) => Ok(Some((updated_at, id))),
        _ => Err(ApiError::BadRequest(
            "cursor_updated_at and cursor_id must be provided together".to_string(),
        )),
    }
}

async fn default_project_directory(
    State(deployment): State<DeploymentImpl>,
) -> Json<ApiResponse<serde_json::Value>> {
    let root = deployment
        .config()
        .read()
        .await
        .managed_workspace_root
        .clone();
    let configured_path = root
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty());
    Json(ApiResponse::success(
        serde_json::json!({ "directory_path": configured_path }),
    ))
}

async fn capabilities() -> Json<ApiResponse<ExecutionDataCapabilities>> {
    Json(ApiResponse::success(ExecutionDataCapabilities {
        owner: ExecutionDataOwner::LocalHost,
        task_queries: true,
        execution_actions: true,
    }))
}

async fn list_projects(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ProjectListQuery>,
) -> Result<Json<ApiResponse<ProjectPage>>, ApiError> {
    let cursor = cursor_parts(query.cursor_updated_at, query.cursor_id)?
        .map(|(updated_at, id)| ProjectCursor { updated_at, id });
    let page =
        Project::list_recent(&deployment.db().pool, cursor, query.limit.unwrap_or(20)).await?;
    Ok(Json(ApiResponse::success(page)))
}

async fn list_sessions(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<SessionListQuery>,
) -> Result<Json<ApiResponse<SessionPage>>, ApiError> {
    let cursor = cursor_parts(query.cursor_updated_at, query.cursor_id)?
        .map(|(updated_at, id)| SessionCursor { updated_at, id });
    let page = Session::list_recent_all(
        &deployment.db().pool,
        query.project_id,
        cursor,
        query.limit.unwrap_or(20),
    )
    .await?;
    Ok(Json(ApiResponse::success(page)))
}

async fn list_executions(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<ExecutionListQuery>,
) -> Result<Json<ApiResponse<ExecutionSummaryPage>>, ApiError> {
    let cursor = cursor_parts(query.cursor_updated_at, query.cursor_id)?
        .map(|(updated_at, id)| ExecutionCursor { updated_at, id });
    let page = Execution::list_top_level(
        &deployment.db().pool,
        query.project_id,
        query.issue_id,
        cursor,
        query.limit.unwrap_or(50),
    )
    .await?;
    Ok(Json(ApiResponse::success(page)))
}

async fn get_execution(
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<Uuid>,
) -> Result<Json<ApiResponse<ExecutionSummary>>, ApiError> {
    let summary = Execution::summary_by_id(&deployment.db().pool, task_id)
        .await?
        .ok_or(ExecutionError::NotFound { task_id })?;
    Ok(Json(ApiResponse::success(summary)))
}

async fn list_execution_children(
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<Uuid>,
    Query(query): Query<ExecutionChildrenQuery>,
) -> Result<Json<ApiResponse<ExecutionSummaryPage>>, ApiError> {
    if Execution::find_by_id(&deployment.db().pool, task_id)
        .await?
        .is_none()
    {
        return Err(ExecutionError::NotFound { task_id }.into());
    }
    let cursor = cursor_parts(query.cursor_updated_at, query.cursor_id)?
        .map(|(updated_at, id)| ExecutionCursor { updated_at, id });
    let page = Execution::list_children(
        &deployment.db().pool,
        task_id,
        cursor,
        query.limit.unwrap_or(50),
    )
    .await?;
    Ok(Json(ApiResponse::success(page)))
}

async fn delete_execution(
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<Uuid>,
    Query(query): Query<DeleteExecutionQuery>,
) -> Result<Json<ApiResponse<db::models::requests::SessionDeletionResult>>, ApiError> {
    let _queue_guard = super::sessions::lock_session_for_deletion(
        deployment.queued_message_service(),
        query.session_id,
    )
    .await?;
    super::workspaces::managed_directory::preflight_files(
        &deployment,
        query.session_id,
        query.delete_managed_files,
    )
    .await?;
    super::sessions::deletion::prepare_deletion(
        &deployment,
        query.session_id,
        Some(task_id),
        query.stop_running,
    )
    .await?;
    let result = super::workspaces::managed_directory::delete(
        &deployment,
        query.session_id,
        Some(task_id),
        query.delete_managed_files,
    )
    .await?;
    Ok(Json(ApiResponse::success(result)))
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/execution-data/capabilities", get(capabilities))
        .route("/projects", get(list_projects))
        .route(
            "/projects/default-directory",
            get(default_project_directory),
        )
        .route("/sessions/recent", get(list_sessions))
        .route("/executions", get(list_executions))
        .route(
            "/executions/{execution_id}",
            get(get_execution).delete(delete_execution),
        )
        .route(
            "/executions/{execution_id}/children",
            get(list_execution_children),
        )
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use uuid::Uuid;

    use super::{
        DeleteExecutionQuery, ExecutionDataCapabilities, ExecutionDataOwner, ExecutionListQuery,
        cursor_parts,
    };

    #[test]
    fn execution_queries_filter_by_business_task_identity() {
        let project_id = Uuid::new_v4();
        let task_id = Uuid::new_v4();
        let query: ExecutionListQuery = serde_json::from_value(serde_json::json!({
            "project_id": project_id,
            "task_id": task_id
        }))
        .unwrap();
        assert_eq!(query.issue_id, Some(task_id));
        let capabilities = serde_json::to_value(ExecutionDataCapabilities {
            owner: ExecutionDataOwner::LocalHost,
            task_queries: true,
            execution_actions: true,
        })
        .unwrap();
        assert_eq!(capabilities["execution_queries"], true);
        assert!(capabilities.get("task_queries").is_none());
    }

    #[test]
    fn task_deletion_requires_the_confirmed_session_identity() {
        assert!(serde_json::from_value::<DeleteExecutionQuery>(serde_json::json!({})).is_err());
        let session_id = Uuid::new_v4();
        let query: DeleteExecutionQuery = serde_json::from_value(serde_json::json!({
            "session_id": session_id
        }))
        .unwrap();
        assert_eq!(query.session_id, session_id);
        assert!(!query.delete_managed_files);
    }

    #[test]
    fn cursor_requires_both_stable_sort_parts() {
        let updated_at = Utc::now();
        let id = Uuid::new_v4();

        assert!(cursor_parts(None, None).unwrap().is_none());
        assert_eq!(
            cursor_parts(Some(updated_at), Some(id)).unwrap(),
            Some((updated_at, id))
        );
        assert!(cursor_parts(Some(updated_at), None).is_err());
        assert!(cursor_parts(None, Some(id)).is_err());
    }
}
