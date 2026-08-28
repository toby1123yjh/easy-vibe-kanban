use api_types::{CreateWorkspaceRequest, PullRequestStatus, UpsertPullRequestRequest};
use axum::{
    Extension, Json, Router,
    extract::{Path as AxumPath, State},
    middleware::from_fn_with_state,
    response::Json as ResponseJson,
    routing::{delete, post},
};
use db::models::{
    merge::MergeStatus,
    pull_request::PullRequest,
    session::Session,
    task::{CreateTask, Task, TaskExecutionKind},
    workspace::Workspace,
};
use deployment::Deployment;
use serde::Deserialize;
use services::services::{diff_stream, remote_client::RemoteClientError, remote_sync};
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError, middleware::load_workspace_middleware};

#[derive(Debug, Deserialize)]
pub struct LinkWorkspaceRequest {
    pub project_id: Uuid,
    pub issue_id: Uuid,
}

async fn ensure_local_agent_task(
    pool: &sqlx::SqlitePool,
    workspace: &Workspace,
    project_id: Uuid,
    issue_id: Uuid,
) -> Result<Task, ApiError> {
    let issue_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM local_issues WHERE id = ? AND project_id = ?)",
    )
    .bind(issue_id)
    .bind(project_id)
    .fetch_one(pool)
    .await?;
    if !issue_exists {
        return Err(ApiError::BadRequest(format!(
            "issue {issue_id} does not belong to project {project_id}"
        )));
    }

    if let Some(task) = Task::find_agent_by_workspace_id(pool, workspace.id).await? {
        if task.project_id != project_id || task.issue_id != issue_id {
            return Err(ApiError::Conflict(format!(
                "workspace {} is already owned by immutable Task {}",
                workspace.id, task.id
            )));
        }
        return Ok(task);
    }

    let session = Session::find_first_by_workspace_id(pool, workspace.id)
        .await?
        .ok_or_else(|| {
            ApiError::Conflict(
                "An Agent Task can only be created after its Session exists".to_string(),
            )
        })?;
    let title = workspace
        .name
        .as_deref()
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or("Agent task")
        .to_string();

    Ok(Task::create_agent_task(
        pool,
        &CreateTask {
            id: Uuid::new_v4(),
            project_id,
            issue_id,
            parent_task_id: None,
            title,
            execution_kind: TaskExecutionKind::Agent,
        },
        session.id,
    )
    .await?)
}

async fn delete_local_agent_task(
    pool: &sqlx::SqlitePool,
    workspace_id: Uuid,
) -> Result<(), ApiError> {
    Task::delete_agent_by_workspace_id(pool, workspace_id).await?;
    Ok(())
}

pub(crate) async fn link_workspace_to_issue(
    deployment: &DeploymentImpl,
    workspace: &Workspace,
    project_id: Uuid,
    issue_id: Uuid,
) -> Result<(), ApiError> {
    ensure_local_agent_task(&deployment.db().pool, workspace, project_id, issue_id).await?;

    if let Ok(client) = deployment.remote_client() {
        let stats =
            diff_stream::compute_diff_stats(&deployment.db().pool, deployment.git(), workspace)
                .await;

        client
            .create_workspace(CreateWorkspaceRequest {
                project_id,
                local_workspace_id: workspace.id,
                issue_id,
                name: workspace.name.clone(),
                archived: Some(workspace.archived),
                files_changed: stats.as_ref().map(|s| s.files_changed as i32),
                lines_added: stats.as_ref().map(|s| s.lines_added as i32),
                lines_removed: stats.as_ref().map(|s| s.lines_removed as i32),
            })
            .await?;

        {
            let pool = deployment.db().pool.clone();
            let ws_id = workspace.id;
            let client = client.clone();
            tokio::spawn(async move {
                let pull_requests = match PullRequest::find_by_workspace_id(&pool, ws_id).await {
                    Ok(prs) => prs,
                    Err(e) => {
                        tracing::error!(
                            "Failed to fetch PRs for workspace {} during link: {}",
                            ws_id,
                            e
                        );
                        return;
                    }
                };
                for pr in pull_requests {
                    let pr_status = match pr.pr_status {
                        MergeStatus::Open => PullRequestStatus::Open,
                        MergeStatus::Merged => PullRequestStatus::Merged,
                        MergeStatus::Closed => PullRequestStatus::Closed,
                        MergeStatus::Unknown => continue,
                    };
                    remote_sync::sync_pr_to_remote(
                        &client,
                        UpsertPullRequestRequest {
                            url: pr.pr_url,
                            number: pr.pr_number as i32,
                            status: pr_status,
                            merged_at: pr.merged_at,
                            merge_commit_sha: pr.merge_commit_sha,
                            target_branch_name: pr.target_branch_name,
                            local_workspace_id: ws_id,
                        },
                    )
                    .await;
                }
            });
        }
    }

    Ok(())
}

pub async fn link_workspace(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<LinkWorkspaceRequest>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    link_workspace_to_issue(
        &deployment,
        &workspace,
        payload.project_id,
        payload.issue_id,
    )
    .await?;

    Ok(ResponseJson(ApiResponse::success(())))
}

pub async fn unlink_workspace(
    AxumPath(workspace_id): AxumPath<uuid::Uuid>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    if let Ok(client) = deployment.remote_client() {
        match client.delete_workspace(workspace_id).await {
            Ok(()) => {}
            Err(RemoteClientError::Http { status: 404, .. }) => {
                // Already absent remotely; still clear the local issue link below.
            }
            Err(e) => return Err(e.into()),
        }
    }

    delete_local_agent_task(&deployment.db().pool, workspace_id).await?;

    Ok(ResponseJson(ApiResponse::success(())))
}

pub fn router(deployment: &DeploymentImpl) -> Router<DeploymentImpl> {
    let post_router = Router::new()
        .route("/", post(link_workspace))
        .layer(from_fn_with_state(
            deployment.clone(),
            load_workspace_middleware,
        ));

    let delete_router = Router::new().route("/", delete(unlink_workspace));

    post_router.merge(delete_router)
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::{
        session::{CreateSession, Session},
        task::Task,
        workspace::{ContainerOwnership, Workspace, WorkspaceKind},
    };
    use sqlx::{SqlitePool, sqlite::SqlitePoolOptions};
    use uuid::Uuid;

    use super::{delete_local_agent_task, ensure_local_agent_task};

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect sqlite");

        for statement in [
            "CREATE TABLE projects (id BLOB PRIMARY KEY)",
            "CREATE TABLE local_issues (id BLOB PRIMARY KEY, project_id BLOB NOT NULL)",
            r#"CREATE TABLE workspaces (
                id BLOB PRIMARY KEY,
                container_ref TEXT,
                workspace_kind TEXT NOT NULL DEFAULT 'worktree',
                container_ownership TEXT NOT NULL DEFAULT 'managed',
                branch TEXT NOT NULL,
                setup_completed_at TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                archived INTEGER NOT NULL DEFAULT 0,
                pinned INTEGER NOT NULL DEFAULT 0,
                name TEXT,
                worktree_deleted BOOLEAN NOT NULL DEFAULT FALSE
            )"#,
            r#"CREATE TABLE sessions (
                id BLOB PRIMARY KEY,
                workspace_id BLOB NOT NULL,
                name TEXT,
                executor TEXT,
                agent_working_dir TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )"#,
            r#"CREATE TABLE tasks (
                id BLOB PRIMARY KEY,
                project_id BLOB NOT NULL,
                issue_id BLOB NOT NULL,
                parent_task_id BLOB,
                title TEXT NOT NULL,
                execution_kind TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )"#,
            r#"CREATE TABLE agent_task_bindings (
                task_id BLOB PRIMARY KEY,
                session_id BLOB NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
            )"#,
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }

        pool
    }

    #[tokio::test]
    async fn linking_workspace_creates_one_immutable_agent_task() {
        let pool = setup_pool().await;
        let workspace_id = Uuid::new_v4();
        let project_id = Uuid::new_v4();
        let issue_id = Uuid::new_v4();
        sqlx::query("INSERT INTO projects (id) VALUES (?)")
            .bind(project_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO local_issues (id, project_id) VALUES (?, ?)")
            .bind(issue_id)
            .bind(project_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO workspaces (id, branch, name) VALUES (?, 'main', 'Build API')")
            .bind(workspace_id)
            .execute(&pool)
            .await
            .unwrap();
        Session::create(
            &pool,
            &CreateSession {
                executor: Some("codex".to_string()),
                name: None,
            },
            Uuid::new_v4(),
            workspace_id,
        )
        .await
        .unwrap();
        let workspace = Workspace {
            id: workspace_id,
            container_ref: None,
            workspace_kind: WorkspaceKind::Worktree,
            container_ownership: ContainerOwnership::Managed,
            branch: "main".to_string(),
            setup_completed_at: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            archived: false,
            pinned: false,
            name: Some("Build API".to_string()),
            worktree_deleted: false,
        };

        let first = ensure_local_agent_task(&pool, &workspace, project_id, issue_id)
            .await
            .unwrap();
        let second = ensure_local_agent_task(&pool, &workspace, project_id, issue_id)
            .await
            .unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(first.title, "Build API");
    }

    #[tokio::test]
    async fn unlinking_workspace_removes_task_but_keeps_session() {
        let pool = setup_pool().await;
        let workspace_id = Uuid::new_v4();
        let session_id = Uuid::new_v4();
        let task_id = Uuid::new_v4();
        sqlx::query("INSERT INTO workspaces (id, branch) VALUES (?, 'main')")
            .bind(workspace_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO sessions (id, workspace_id) VALUES (?, ?)")
            .bind(session_id)
            .bind(workspace_id)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO tasks (id, project_id, issue_id, title, execution_kind) VALUES (?, ?, ?, 'Task', 'agent')")
            .bind(task_id)
            .bind(Uuid::new_v4())
            .bind(Uuid::new_v4())
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO agent_task_bindings (task_id, session_id) VALUES (?, ?)")
            .bind(task_id)
            .bind(session_id)
            .execute(&pool)
            .await
            .unwrap();

        delete_local_agent_task(&pool, workspace_id).await.unwrap();
        assert!(
            Task::find_agent_by_workspace_id(&pool, workspace_id)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            Session::find_by_id(&pool, session_id)
                .await
                .unwrap()
                .is_some()
        );
    }
}
