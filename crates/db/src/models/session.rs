use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqliteConnection, SqlitePool};
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
    #[error(
        "Session is bound to Agent Task {task_id}; delete the task before deleting this session"
    )]
    AgentTaskBound { task_id: Uuid },
    #[error("Session has an active agent run; stop it before deleting this session")]
    ActiveAgentRun,
    #[error("Session has a running execution process; stop it before deleting this session")]
    ActiveExecutionProcess,
    #[error(
        "Session has a live or unreachable agent process; stop it before deleting this session"
    )]
    ActiveAgentProcess,
    #[error(
        "Session is owned or referenced by a Workflow or Arena and cannot be deleted independently"
    )]
    DeletionDependency,
}

impl SessionError {
    pub(crate) fn from_deletion_error(error: sqlx::Error) -> Self {
        // SQLite implements ON DELETE RESTRICT with an internal trigger, so
        // it reports SQLITE_CONSTRAINT_TRIGGER (1811), not FOREIGNKEY (787).
        // Do not classify unrelated user-trigger failures as FK dependencies.
        if matches!(&error, sqlx::Error::Database(error) if
            error.is_foreign_key_violation()
            || (error.code().as_deref() == Some("1811")
                && error.message() == "FOREIGN KEY constraint failed"))
        {
            Self::DeletionDependency
        } else {
            Self::Database(error)
        }
    }
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
    pub task_id: Option<Uuid>,
    pub project_id: Option<Uuid>,
    pub issue_id: Option<Uuid>,
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
    fn session_page(mut sessions: Vec<SessionListItem>, page_size: i64) -> SessionPage {
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

        SessionPage {
            sessions,
            next_cursor,
        }
    }

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

    /// Delete an ordinary session and its session-owned runtime records.
    ///
    /// Agent-task sessions are deliberately protected: deleting one would
    /// leave the canonical task without its required session binding. Runtime
    /// and process checks are repeated in this transaction so a route-level
    /// preflight cannot race a session start between validation and deletion.
    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, SessionError> {
        let mut transaction = pool.begin_with("BEGIN IMMEDIATE").await?;
        let deleted = Self::delete_in_transaction(&mut transaction, id).await?;
        transaction
            .commit()
            .await
            .map_err(SessionError::from_deletion_error)?;
        Ok(deleted)
    }

    /// Shared guarded deletion for standalone Sessions and exact Agent Task
    /// deletion. The caller must hold a write transaction and remove the Task
    /// in that same transaction before calling this method.
    pub async fn delete_in_transaction(
        connection: &mut SqliteConnection,
        id: Uuid,
    ) -> Result<u64, SessionError> {
        let exists =
            sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?)")
                .bind(id)
                .fetch_one(&mut *connection)
                .await?;
        if !exists {
            return Err(SessionError::NotFound);
        }

        let task_id = sqlx::query_scalar::<_, Uuid>(
            "SELECT task_id FROM agent_task_bindings WHERE session_id = ? LIMIT 1",
        )
        .bind(id)
        .fetch_optional(&mut *connection)
        .await?;
        if let Some(task_id) = task_id {
            return Err(SessionError::AgentTaskBound { task_id });
        }

        let has_active_agent_run = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS(
                SELECT 1
                FROM agent_runs run
                WHERE run.session_id = ?
                  AND (run.status NOT IN (
                      'succeeded', 'failed', 'cancelled', 'crashed', 'audit_failed'
                  ) OR EXISTS (
                      SELECT 1 FROM agent_run_attempts attempt
                      WHERE attempt.agent_run_id = run.id
                        AND attempt.status NOT IN (
                            'succeeded', 'failed', 'cancelled', 'crashed', 'audit_failed'
                        )
                  ))
            )
            "#,
        )
        .bind(id)
        .fetch_one(&mut *connection)
        .await?;
        if has_active_agent_run {
            return Err(SessionError::ActiveAgentRun);
        }

        // A terminal run can still have an unreachable/live provider process.
        // Keep its registry and audit identities until process exit is observed.
        let has_live_agent_process = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM agent_runs run
                JOIN agent_run_attempts attempt ON attempt.agent_run_id = run.id
                JOIN agent_process_registry registry ON registry.run_attempt_id = attempt.id
                WHERE run.session_id = ?
                  AND (
                      registry.registry_status IN ('spawned', 'running', 'unreachable')
                      OR (registry.registry_status = 'reserved' AND registry.host_pid IS NOT NULL)
                  )
            )
            "#,
        )
        .bind(id)
        .fetch_one(&mut *connection)
        .await?;
        if has_live_agent_process {
            return Err(SessionError::ActiveAgentProcess);
        }

        let has_running_process = sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM execution_processes WHERE session_id = ? AND status = 'running')",
        )
        .bind(id)
        .fetch_one(&mut *connection)
        .await?;
        if has_running_process {
            return Err(SessionError::ActiveExecutionProcess);
        }

        Self::validate_deletion_dependencies(connection, id).await?;

        // Scratch records use a generic UUID key rather than a foreign key to
        // sessions, so remove session-scoped drafts explicitly.
        sqlx::query("DELETE FROM scratch WHERE id = ?")
            .bind(id)
            .execute(&mut *connection)
            .await?;

        let result = sqlx::query("DELETE FROM sessions WHERE id = ?")
            .bind(id)
            .execute(&mut *connection)
            .await
            .map_err(SessionError::from_deletion_error)?;
        Ok(result.rows_affected())
    }

    /// Ownership must be checked before requesting any process stop, too.
    pub async fn validate_deletion_dependencies(
        connection: &mut SqliteConnection,
        id: Uuid,
    ) -> Result<(), SessionError> {
        // Some orchestration references SET NULL or CASCADE on deletion rather
        // than restricting it. Reject them explicitly to preserve their owner.
        let has_dependencies = sqlx::query_scalar::<_, bool>(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM node_executions node
                WHERE node.session_id = ?1
                   OR node.agent_run_id IN (SELECT id FROM agent_runs WHERE session_id = ?1)
                   OR node.execution_process_id IN (
                       SELECT id FROM execution_processes WHERE session_id = ?1
                   )
            ) OR EXISTS(
                SELECT 1 FROM orchestration_agent_run_links link
                JOIN agent_runs run ON run.id = link.agent_run_id
                WHERE run.session_id = ?1
            ) OR EXISTS(
                SELECT 1 FROM arena_candidates candidate
                JOIN sessions session ON session.workspace_id = candidate.workspace_id
                WHERE session.id = ?1
            )
            "#,
        )
        .bind(id)
        .fetch_one(&mut *connection)
        .await?;
        if has_dependencies {
            return Err(SessionError::DeletionDependency);
        }

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

        let sessions = query
            .build_query_as::<SessionListItem>()
            .fetch_all(pool)
            .await?;
        Ok(Self::session_page(sessions, page_size))
    }

    /// List all recent sessions, including sessions that have not been linked
    /// to a canonical Agent Task yet. Task metadata is optional for these
    /// ordinary workspace sessions.
    pub async fn list_recent_all(
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
                   COALESCE(task.project_id, membership.project_id) AS project_id,
                   task.issue_id,
                   COALESCE(
                       NULLIF(trim(task.title), ''),
                       NULLIF(trim(session.name), ''),
                       NULLIF(trim(workspace.name), ''),
                       'Untitled session'
                   ) AS title,
                   session.executor,
                   session.created_at,
                   session.updated_at
            FROM sessions session
            JOIN workspaces workspace ON workspace.id = session.workspace_id
            JOIN session_project_memberships membership ON membership.session_id = session.id
            LEFT JOIN agent_task_bindings binding ON binding.session_id = session.id
            LEFT JOIN tasks task
                ON task.id = binding.task_id AND task.execution_kind = 'agent'
            WHERE 1 = 1
            "#,
        );
        if let Some(project_id) = project_id {
            query
                .push(" AND COALESCE(task.project_id, membership.project_id) = ")
                .push_bind(project_id);
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

        let sessions = query
            .build_query_as::<SessionListItem>()
            .fetch_all(pool)
            .await?;

        Ok(Self::session_page(sessions, page_size))
    }
}
