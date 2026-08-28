use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqlitePool};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

use super::{
    task::{CreateTask, Task, TaskError, TaskExecutionKind},
    workspace::Workspace,
    workspace_repo::WorkspaceRepo,
};

#[derive(Debug, Error)]
pub enum SessionError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Task(#[from] TaskError),
    #[error("Session not found")]
    NotFound,
    #[error("Workspace not found")]
    WorkspaceNotFound,
    #[error("Executor mismatch: session uses {expected} but request specified {actual}")]
    ExecutorMismatch { expected: String, actual: String },
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct Session {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: Option<String>,
    pub executor: Option<String>,
    pub agent_working_dir: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Eq, FromRow, Serialize, Deserialize, TS)]
pub struct SessionListItem {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub task_id: Uuid,
    pub project_id: Uuid,
    pub issue_id: Uuid,
    pub title: String,
    pub executor: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionCursor {
    pub updated_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SessionPage {
    pub sessions: Vec<SessionListItem>,
    pub next_cursor: Option<SessionCursor>,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateSession {
    pub executor: Option<String>,
    pub name: Option<String>,
}

impl Session {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            Session,
            r#"SELECT id AS "id!: Uuid",
                      workspace_id AS "workspace_id!: Uuid",
                      name,
                      executor,
                      agent_working_dir,
                      created_at AS "created_at!: DateTime<Utc>",
                      updated_at AS "updated_at!: DateTime<Utc>"
               FROM sessions
               WHERE id = $1"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    /// Find all sessions for a workspace, ordered by most recently used.
    /// "Most recently used" is defined as the most recent non-dev server execution process.
    /// Sessions with no executions fall back to created_at for ordering.
    pub async fn find_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            Session,
            r#"SELECT s.id AS "id!: Uuid",
                      s.workspace_id AS "workspace_id!: Uuid",
                      s.name,
                      s.executor,
                      s.agent_working_dir,
                      s.created_at AS "created_at!: DateTime<Utc>",
                      s.updated_at AS "updated_at!: DateTime<Utc>"
               FROM sessions s
               LEFT JOIN (
                   SELECT ep.session_id, MAX(ep.created_at) as last_used
                   FROM execution_processes ep
                   WHERE ep.run_reason != 'devserver' AND ep.dropped = FALSE
                   GROUP BY ep.session_id
               ) latest_ep ON s.id = latest_ep.session_id
               WHERE s.workspace_id = $1
               ORDER BY COALESCE(latest_ep.last_used, s.created_at) DESC"#,
            workspace_id
        )
        .fetch_all(pool)
        .await
    }

    /// Find the most recently used session for a workspace.
    /// "Most recently used" is defined as the most recent non-dev server execution process.
    /// Sessions with no executions fall back to created_at for ordering.
    pub async fn find_latest_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            Session,
            r#"SELECT s.id AS "id!: Uuid",
                      s.workspace_id AS "workspace_id!: Uuid",
                      s.name,
                      s.executor,
                      s.agent_working_dir,
                      s.created_at AS "created_at!: DateTime<Utc>",
                      s.updated_at AS "updated_at!: DateTime<Utc>"
               FROM sessions s
               LEFT JOIN (
                   SELECT ep.session_id, MAX(ep.created_at) as last_used
                   FROM execution_processes ep
                   WHERE ep.run_reason != 'devserver' AND ep.dropped = FALSE
                   GROUP BY ep.session_id
               ) latest_ep ON s.id = latest_ep.session_id
               WHERE s.workspace_id = $1
               ORDER BY COALESCE(latest_ep.last_used, s.created_at) DESC
               LIMIT 1"#,
            workspace_id
        )
        .fetch_optional(pool)
        .await
    }

    /// Find the first-created session for a workspace.
    /// This is a temporary policy for orchestrator MCP session discovery.
    pub async fn find_first_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Session>(
            r#"SELECT id,
                      workspace_id,
                      name,
                      executor,
                      agent_working_dir,
                      created_at,
                      updated_at
               FROM sessions
               WHERE workspace_id = ?
               ORDER BY created_at ASC, id ASC
               LIMIT 1"#,
        )
        .bind(workspace_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateSession,
        id: Uuid,
        workspace_id: Uuid,
    ) -> Result<Self, SessionError> {
        let agent_working_dir = Self::resolve_agent_working_dir(pool, workspace_id).await?;
        let name = data.name.as_deref().filter(|s| !s.is_empty());

        Ok(sqlx::query_as!(
            Session,
            r#"INSERT INTO sessions (id, workspace_id, name, executor, agent_working_dir)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id AS "id!: Uuid",
                         workspace_id AS "workspace_id!: Uuid",
                         name,
                         executor,
                         agent_working_dir,
                         created_at AS "created_at!: DateTime<Utc>",
                         updated_at AS "updated_at!: DateTime<Utc>""#,
            id,
            workspace_id,
            name,
            data.executor,
            agent_working_dir
        )
        .fetch_one(pool)
        .await?)
    }

    pub async fn create_with_agent_task(
        pool: &SqlitePool,
        data: &CreateSession,
        id: Uuid,
        workspace_id: Uuid,
        task: &CreateTask,
    ) -> Result<(Self, Task), SessionError> {
        if task.execution_kind != TaskExecutionKind::Agent {
            return Err(TaskError::InvalidBinding {
                task_id: task.id,
                detail: "Session binding requires execution_kind=agent".to_string(),
            }
            .into());
        }

        let agent_working_dir = Self::resolve_agent_working_dir(pool, workspace_id).await?;
        let name = data.name.as_deref().filter(|name| !name.is_empty());
        let mut transaction = pool.begin().await?;
        let session = sqlx::query_as::<_, Session>(
            r#"
            INSERT INTO sessions (id, workspace_id, name, executor, agent_working_dir)
            VALUES (?, ?, ?, ?, ?)
            RETURNING id, workspace_id, name, executor, agent_working_dir,
                      created_at, updated_at
            "#,
        )
        .bind(id)
        .bind(workspace_id)
        .bind(name)
        .bind(&data.executor)
        .bind(agent_working_dir)
        .fetch_one(&mut *transaction)
        .await?;
        let task = Task::create(&mut transaction, task).await?;
        Task::bind_agent_session(&mut transaction, task.id, session.id).await?;
        transaction.commit().await?;
        Ok((session, task))
    }

    pub async fn resolve_agent_working_dir(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Option<String>, sqlx::Error> {
        let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace_id).await?;
        if repos.len() != 1 {
            return Ok(None);
        }

        let repo = &repos[0];
        let workspace = Workspace::find_by_id(pool, workspace_id).await?;
        let path = match (
            workspace.as_ref().map(Workspace::is_direct_folder),
            repo.default_working_dir.as_deref(),
        ) {
            (Some(true), _) => std::path::PathBuf::from(&repo.name),
            (_, Some(subdir)) if !subdir.is_empty() => {
                std::path::PathBuf::from(&repo.name).join(subdir)
            }
            _ => std::path::PathBuf::from(&repo.name),
        };

        Ok(Some(path.to_string_lossy().to_string()))
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        name: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        let name_value = name.filter(|s| !s.is_empty());
        let name_provided = name.is_some();

        sqlx::query!(
            r#"UPDATE sessions SET
                name = CASE WHEN $1 THEN $2 ELSE name END,
                updated_at = datetime('now', 'subsec')
            WHERE id = $3"#,
            name_provided,
            name_value,
            id
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn update_executor(
        pool: &SqlitePool,
        id: Uuid,
        executor: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"UPDATE sessions SET executor = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2"#,
            executor,
            id
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn list_recent_task_bound(
        pool: &SqlitePool,
        project_id: Option<Uuid>,
        cursor: Option<SessionCursor>,
        limit: u32,
    ) -> Result<SessionPage, sqlx::Error> {
        let page_size = limit.clamp(1, 100) as i64;
        let mut query = QueryBuilder::<Sqlite>::new(
            r#"
            SELECT session.id,
                   session.workspace_id,
                   task.id AS task_id,
                   task.project_id,
                   task.issue_id,
                   task.title,
                   session.executor,
                   session.created_at,
                   session.updated_at
            FROM sessions session
            JOIN agent_task_bindings binding ON binding.session_id = session.id
            JOIN tasks task ON task.id = binding.task_id
            WHERE task.execution_kind = 'agent'
            "#,
        );
        if let Some(project_id) = project_id {
            query.push(" AND task.project_id = ").push_bind(project_id);
        }
        if let Some(cursor) = cursor {
            query
                .push(" AND (julianday(session.updated_at) < julianday(")
                .push_bind(cursor.updated_at)
                .push(") OR (julianday(session.updated_at) = julianday(")
                .push_bind(cursor.updated_at)
                .push(") AND session.id > ")
                .push_bind(cursor.id)
                .push("))");
        }
        query
            .push(" ORDER BY julianday(session.updated_at) DESC, session.id ASC LIMIT ")
            .push_bind(page_size + 1);

        let mut sessions = query
            .build_query_as::<SessionListItem>()
            .fetch_all(pool)
            .await?;
        let has_more = sessions.len() > page_size as usize;
        if has_more {
            sessions.pop();
        }
        let next_cursor = has_more.then(|| {
            let last = sessions
                .last()
                .expect("a paginated Session page with more rows is non-empty");
            SessionCursor {
                updated_at: last.updated_at,
                id: last.id,
            }
        });

        Ok(SessionPage {
            sessions,
            next_cursor,
        })
    }
}
