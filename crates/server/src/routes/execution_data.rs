use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::get,
};
use chrono::{DateTime, Utc};
use db::models::{
    project::{Project, ProjectCursor, ProjectPage},
    session::{Session, SessionCursor, SessionPage},
    task::{Task, TaskCursor, TaskError, TaskSummary, TaskSummaryPage},
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
pub struct TaskListQuery {
    pub project_id: Uuid,
    pub issue_id: Option<Uuid>,
    pub cursor_updated_at: Option<DateTime<Utc>>,
    pub cursor_id: Option<Uuid>,
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct TaskChildrenQuery {
    pub cursor_updated_at: Option<DateTime<Utc>>,
    pub cursor_id: Option<Uuid>,
    pub limit: Option<u32>,
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
    let page = Session::list_recent_task_bound(
        &deployment.db().pool,
        query.project_id,
        cursor,
        query.limit.unwrap_or(20),
    )
    .await?;
    Ok(Json(ApiResponse::success(page)))
}

async fn list_tasks(
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<TaskListQuery>,
) -> Result<Json<ApiResponse<TaskSummaryPage>>, ApiError> {
    let cursor = cursor_parts(query.cursor_updated_at, query.cursor_id)?
        .map(|(updated_at, id)| TaskCursor { updated_at, id });
    let page = Task::list_top_level(
        &deployment.db().pool,
        query.project_id,
        query.issue_id,
        cursor,
        query.limit.unwrap_or(50),
    )
    .await?;
    Ok(Json(ApiResponse::success(page)))
}

async fn get_task(
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<Uuid>,
) -> Result<Json<ApiResponse<TaskSummary>>, ApiError> {
    let summary = Task::summary_by_id(&deployment.db().pool, task_id)
        .await?
        .ok_or(TaskError::NotFound { task_id })?;
    Ok(Json(ApiResponse::success(summary)))
}

async fn list_task_children(
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<Uuid>,
    Query(query): Query<TaskChildrenQuery>,
) -> Result<Json<ApiResponse<TaskSummaryPage>>, ApiError> {
    if Task::find_by_id(&deployment.db().pool, task_id)
        .await?
        .is_none()
    {
        return Err(TaskError::NotFound { task_id }.into());
    }
    let cursor = cursor_parts(query.cursor_updated_at, query.cursor_id)?
        .map(|(updated_at, id)| TaskCursor { updated_at, id });
    let page = Task::list_children(
        &deployment.db().pool,
        task_id,
        cursor,
        query.limit.unwrap_or(50),
    )
    .await?;
    Ok(Json(ApiResponse::success(page)))
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/execution-data/capabilities", get(capabilities))
        .route("/projects", get(list_projects))
        .route("/sessions/recent", get(list_sessions))
        .route("/tasks", get(list_tasks))
        .route("/tasks/{task_id}", get(get_task))
        .route("/tasks/{task_id}/children", get(list_task_children))
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use uuid::Uuid;

    use super::cursor_parts;

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
