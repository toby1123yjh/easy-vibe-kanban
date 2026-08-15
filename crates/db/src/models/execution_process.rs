use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use executors::actions::ExecutorAction;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{FromRow, SqlitePool, Type};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

use super::{
    execution_process_repo_state::{CreateExecutionProcessRepoState, ExecutionProcessRepoState},
    repo::Repo,
    session::Session,
    workspace::Workspace,
    workspace_repo::WorkspaceRepo,
};

#[derive(Debug, Error)]
pub enum ExecutionProcessError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("Execution process not found")]
    ExecutionProcessNotFound,
    #[error("Failed to create execution process: {0}")]
    CreateFailed(String),
    #[error("Failed to update execution process: {0}")]
    UpdateFailed(String),
    #[error("Invalid executor action format")]
    InvalidExecutorAction,
    #[error("Validation error: {0}")]
    ValidationError(String),
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "execution_process_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(use_ts_enum)]
pub enum ExecutionProcessStatus {
    Running,
    Completed,
    Failed,
    Killed,
}

#[derive(Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS)]
#[sqlx(type_name = "execution_process_run_reason", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum ExecutionProcessRunReason {
    SetupScript,
    CleanupScript,
    ArchiveScript,
    DevServer,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct ExecutionProcess {
    pub id: Uuid,
    pub session_id: Uuid,
    pub run_reason: ExecutionProcessRunReason,
    #[ts(type = "ExecutorAction")]
    pub executor_action: sqlx::types::Json<ExecutorActionField>,
    pub status: ExecutionProcessStatus,
    pub exit_code: Option<i64>,
    /// dropped: true if this process is excluded from the current
    /// history view (due to restore/trimming). Hidden from logs/timeline;
    /// still listed in the Processes tab.
    pub dropped: bool,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(rename = "ExecutionProcess")]
pub struct ExecutionProcessView {
    pub id: Uuid,
    pub session_id: Uuid,
    pub run_reason: ExecutionProcessRunReason,
    #[ts(type = "ExecutorAction")]
    pub executor_action: sqlx::types::Json<ExecutorActionField>,
    pub status: ExecutionProcessStatus,
    pub exit_code: Option<i64>,
    /// dropped: true if this process is excluded from the current
    /// history view (due to restore/trimming). Hidden from logs/timeline;
    /// still listed in the Processes tab.
    pub dropped: bool,
    pub started_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl ExecutionProcessView {
    pub fn from_process(process: ExecutionProcess) -> Self {
        Self {
            id: process.id,
            session_id: process.session_id,
            run_reason: process.run_reason,
            executor_action: process.executor_action,
            status: process.status,
            exit_code: process.exit_code,
            dropped: process.dropped,
            started_at: process.started_at,
            completed_at: process.completed_at,
            created_at: process.created_at,
            updated_at: process.updated_at,
        }
    }
}

impl From<ExecutionProcess> for ExecutionProcessView {
    fn from(process: ExecutionProcess) -> Self {
        Self::from_process(process)
    }
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateExecutionProcess {
    pub session_id: Uuid,
    pub executor_action: ExecutorAction,
    pub run_reason: ExecutionProcessRunReason,
}

#[derive(Debug)]
pub struct ExecutionContext {
    pub execution_process: ExecutionProcess,
    pub session: Session,
    pub workspace: Workspace,
    pub repos: Vec<Repo>,
}

/// Summary info about the latest execution process for a workspace
#[derive(Debug, Clone, FromRow)]
pub struct LatestProcessInfo {
    pub workspace_id: Uuid,
    pub execution_process_id: Uuid,
    pub session_id: Uuid,
    pub status: ExecutionProcessStatus,
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ExecutorActionField {
    ExecutorAction(ExecutorAction),
    Other(Value),
}

impl ExecutionProcess {
    /// Find execution process by ID
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            ExecutionProcess,
            r#"SELECT
                    ep.id as "id!: Uuid",
                    ep.session_id as "session_id!: Uuid",
                    ep.run_reason as "run_reason!: ExecutionProcessRunReason",
                    ep.executor_action as "executor_action!: sqlx::types::Json<ExecutorActionField>",
                    ep.status as "status!: ExecutionProcessStatus",
                    ep.exit_code,
                    ep.dropped as "dropped!: bool",
                    ep.started_at as "started_at!: DateTime<Utc>",
                    ep.completed_at as "completed_at?: DateTime<Utc>",
                    ep.created_at as "created_at!: DateTime<Utc>",
                    ep.updated_at as "updated_at!: DateTime<Utc>"
               FROM execution_processes ep WHERE ep.id = ?"#,
            id
        )
        .fetch_optional(pool)
        .await
    }

    /// Find execution process by rowid
    pub async fn find_by_rowid(pool: &SqlitePool, rowid: i64) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            ExecutionProcess,
            r#"SELECT
                    ep.id as "id!: Uuid",
                    ep.session_id as "session_id!: Uuid",
                    ep.run_reason as "run_reason!: ExecutionProcessRunReason",
                    ep.executor_action as "executor_action!: sqlx::types::Json<ExecutorActionField>",
                    ep.status as "status!: ExecutionProcessStatus",
                    ep.exit_code,
                    ep.dropped as "dropped!: bool",
                    ep.started_at as "started_at!: DateTime<Utc>",
                    ep.completed_at as "completed_at?: DateTime<Utc>",
                    ep.created_at as "created_at!: DateTime<Utc>",
                    ep.updated_at as "updated_at!: DateTime<Utc>"
               FROM execution_processes ep WHERE ep.rowid = ?"#,
            rowid
        )
        .fetch_optional(pool)
        .await
    }

    /// Find all execution processes for a session (optionally include soft-deleted)
    pub async fn find_by_session_id(
        pool: &SqlitePool,
        session_id: Uuid,
        show_soft_deleted: bool,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ExecutionProcess,
            r#"SELECT
                      ep.id              as "id!: Uuid",
                      ep.session_id      as "session_id!: Uuid",
                      ep.run_reason      as "run_reason!: ExecutionProcessRunReason",
                      ep.executor_action as "executor_action!: sqlx::types::Json<ExecutorActionField>",
                      ep.status          as "status!: ExecutionProcessStatus",
                      ep.exit_code,
                      ep.dropped as "dropped!: bool",
                      ep.started_at      as "started_at!: DateTime<Utc>",
                      ep.completed_at    as "completed_at?: DateTime<Utc>",
                      ep.created_at      as "created_at!: DateTime<Utc>",
                      ep.updated_at      as "updated_at!: DateTime<Utc>"
               FROM execution_processes ep
               WHERE ep.session_id = ?
                 AND (? OR ep.dropped = FALSE)
               ORDER BY ep.created_at ASC"#,
            session_id,
            show_soft_deleted
        )
        .fetch_all(pool)
        .await
    }

    /// Find running execution processes
    pub async fn find_running(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ExecutionProcess,
            r#"SELECT
                    ep.id as "id!: Uuid",
                    ep.session_id as "session_id!: Uuid",
                    ep.run_reason as "run_reason!: ExecutionProcessRunReason",
                    ep.executor_action as "executor_action!: sqlx::types::Json<ExecutorActionField>",
                    ep.status as "status!: ExecutionProcessStatus",
                    ep.exit_code,
                    ep.dropped as "dropped!: bool",
                    ep.started_at as "started_at!: DateTime<Utc>",
                    ep.completed_at as "completed_at?: DateTime<Utc>",
                    ep.created_at as "created_at!: DateTime<Utc>",
                    ep.updated_at as "updated_at!: DateTime<Utc>"
               FROM execution_processes ep WHERE ep.status = 'running' ORDER BY ep.created_at ASC"#,
        )
        .fetch_all(pool)
        .await
    }

    /// Check if there are running processes (excluding dev servers) for a workspace (across all sessions)
    pub async fn has_running_non_dev_server_processes_for_workspace(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        let count: i64 = sqlx::query_scalar!(
            r#"SELECT COUNT(*) as "count!: i64"
               FROM execution_processes ep
               JOIN sessions s ON ep.session_id = s.id
               WHERE s.workspace_id = $1
                 AND ep.status = 'running'
                 AND ep.run_reason != 'devserver'"#,
            workspace_id
        )
        .fetch_one(pool)
        .await?;
        Ok(count > 0)
    }

    /// Find running dev servers for a specific workspace (across all sessions)
    pub async fn find_running_dev_servers_by_workspace(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ExecutionProcess,
            r#"
        SELECT
            ep.id as "id!: Uuid",
            ep.session_id as "session_id!: Uuid",
            ep.run_reason as "run_reason!: ExecutionProcessRunReason",
            ep.executor_action as "executor_action!: sqlx::types::Json<ExecutorActionField>",
            ep.status as "status!: ExecutionProcessStatus",
            ep.exit_code,
            ep.dropped as "dropped!: bool",
            ep.started_at as "started_at!: DateTime<Utc>",
            ep.completed_at as "completed_at?: DateTime<Utc>",
            ep.created_at as "created_at!: DateTime<Utc>",
            ep.updated_at as "updated_at!: DateTime<Utc>"
        FROM execution_processes ep
        JOIN sessions s ON ep.session_id = s.id
        WHERE s.workspace_id = ?
          AND ep.status = 'running'
          AND ep.run_reason = 'devserver'
        ORDER BY ep.created_at DESC
        "#,
            workspace_id
        )
        .fetch_all(pool)
        .await
    }

    /// Find latest execution process by session and run reason
    /// Find latest execution process by workspace and run reason (across all sessions)
    pub async fn find_latest_by_workspace_and_run_reason(
        pool: &SqlitePool,
        workspace_id: Uuid,
        run_reason: &ExecutionProcessRunReason,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            ExecutionProcess,
            r#"SELECT
                    ep.id as "id!: Uuid",
                    ep.session_id as "session_id!: Uuid",
                    ep.run_reason as "run_reason!: ExecutionProcessRunReason",
                    ep.executor_action as "executor_action!: sqlx::types::Json<ExecutorActionField>",
                    ep.status as "status!: ExecutionProcessStatus",
                    ep.exit_code,
                    ep.dropped as "dropped!: bool",
                    ep.started_at as "started_at!: DateTime<Utc>",
                    ep.completed_at as "completed_at?: DateTime<Utc>",
                    ep.created_at as "created_at!: DateTime<Utc>",
                    ep.updated_at as "updated_at!: DateTime<Utc>"
               FROM execution_processes ep
               JOIN sessions s ON ep.session_id = s.id
               WHERE s.workspace_id = ? AND ep.run_reason = ? AND ep.dropped = FALSE
               ORDER BY ep.created_at DESC LIMIT 1"#,
            workspace_id,
            run_reason
        )
        .fetch_optional(pool)
        .await
    }

    /// Create a new execution process
    ///
    /// Note: We intentionally avoid using a transaction here. SQLite update
    /// hooks fire during transactions (before commit), and the hook spawns an
    /// async task that queries `find_by_rowid` on a different connection.
    /// If we used a transaction, that query would not see the uncommitted row,
    /// causing the WebSocket event to be lost.
    pub async fn create(
        pool: &SqlitePool,
        data: &CreateExecutionProcess,
        process_id: Uuid,
        repo_states: &[CreateExecutionProcessRepoState],
    ) -> Result<Self, sqlx::Error> {
        let now = Utc::now();
        let executor_action_json = sqlx::types::Json(&data.executor_action);

        sqlx::query!(
            r#"INSERT INTO execution_processes (
                    id, session_id, run_reason, executor_action,
                    status, exit_code, started_at, completed_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"#,
            process_id,
            data.session_id,
            data.run_reason,
            executor_action_json,
            ExecutionProcessStatus::Running,
            None::<i64>,
            now,
            None::<DateTime<Utc>>,
            now,
            now
        )
        .execute(pool)
        .await?;

        ExecutionProcessRepoState::create_many(pool, process_id, repo_states).await?;

        Self::find_by_id(pool, process_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)
    }

    pub async fn was_stopped(pool: &SqlitePool, id: Uuid) -> bool {
        if let Ok(exp_process) = Self::find_by_id(pool, id).await
            && exp_process.is_some_and(|ep| {
                ep.status == ExecutionProcessStatus::Killed
                    || ep.status == ExecutionProcessStatus::Completed
            })
        {
            return true;
        }
        false
    }

    /// Update execution process status and completion info
    pub async fn update_completion(
        pool: &SqlitePool,
        id: Uuid,
        status: ExecutionProcessStatus,
        exit_code: Option<i64>,
    ) -> Result<(), sqlx::Error> {
        let completed_at = if matches!(status, ExecutionProcessStatus::Running) {
            None
        } else {
            Some(Utc::now())
        };

        sqlx::query!(
            r#"UPDATE execution_processes
               SET status = $1, exit_code = $2, completed_at = $3
               WHERE id = $4"#,
            status,
            exit_code,
            completed_at,
            id
        )
        .execute(pool)
        .await?;

        Ok(())
    }

    pub fn executor_action(&self) -> Result<&ExecutorAction, anyhow::Error> {
        match &self.executor_action.0 {
            ExecutorActionField::ExecutorAction(action) => Ok(action),
            ExecutorActionField::Other(_) => Err(anyhow::anyhow!(
                "Executor action is not a valid ExecutorAction JSON object"
            )),
        }
    }

    /// Soft-drop processes at and after the specified boundary (inclusive)
    pub async fn drop_at_and_after(
        pool: &SqlitePool,
        session_id: Uuid,
        boundary_process_id: Uuid,
    ) -> Result<i64, sqlx::Error> {
        let result = sqlx::query!(
            r#"UPDATE execution_processes
               SET dropped = TRUE
             WHERE session_id = $1
               AND created_at >= (SELECT created_at FROM execution_processes WHERE id = $2)
               AND dropped = FALSE"#,
            session_id,
            boundary_process_id
        )
        .execute(pool)
        .await?;
        Ok(result.rows_affected() as i64)
    }

    /// Find the previous process's after_head_commit before the given boundary process
    /// for a specific repository
    pub async fn find_prev_after_head_commit(
        pool: &SqlitePool,
        session_id: Uuid,
        boundary_process_id: Uuid,
        repo_id: Uuid,
    ) -> Result<Option<String>, sqlx::Error> {
        let result = sqlx::query_scalar!(
            r#"SELECT eprs.after_head_commit
               FROM execution_process_repo_states eprs
               JOIN execution_processes ep ON ep.id = eprs.execution_process_id
              WHERE ep.session_id = $1
                AND eprs.repo_id = $2
                AND ep.created_at < (SELECT created_at FROM execution_processes WHERE id = $3)
              ORDER BY ep.created_at DESC
              LIMIT 1"#,
            session_id,
            repo_id,
            boundary_process_id
        )
        .fetch_optional(pool)
        .await?;
        Ok(result.flatten())
    }

    /// Get both the parent Workspace and Session for this execution process
    pub async fn parent_workspace_and_session(
        &self,
        pool: &SqlitePool,
    ) -> Result<Option<(Workspace, Session)>, sqlx::Error> {
        let session = match Session::find_by_id(pool, self.session_id).await? {
            Some(s) => s,
            None => return Ok(None),
        };
        let workspace = match Workspace::find_by_id(pool, session.workspace_id).await? {
            Some(w) => w,
            None => return Ok(None),
        };
        Ok(Some((workspace, session)))
    }

    /// Load execution context with related session, workspace, task, project, and repos
    pub async fn load_context(
        pool: &SqlitePool,
        exec_id: Uuid,
    ) -> Result<ExecutionContext, sqlx::Error> {
        let execution_process = Self::find_by_id(pool, exec_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;

        let session = Session::find_by_id(pool, execution_process.session_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;

        let workspace = Workspace::find_by_id(pool, session.workspace_id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;

        let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace.id).await?;

        Ok(ExecutionContext {
            execution_process,
            session,
            workspace,
            repos,
        })
    }

    /// Fetch latest execution process info for all workspaces with the given archived status.
    /// Returns a map of workspace_id -> LatestProcessInfo for the most recent
    /// non-dropped execution process (excluding dev servers).
    pub async fn find_latest_for_workspaces(
        pool: &SqlitePool,
        archived: bool,
    ) -> Result<HashMap<Uuid, LatestProcessInfo>, sqlx::Error> {
        let rows: Vec<LatestProcessInfo> = sqlx::query_as::<_, LatestProcessInfo>(
            r#"
            SELECT
                workspace_id as "workspace_id!: Uuid",
                execution_process_id as "execution_process_id!: Uuid",
                session_id as "session_id!: Uuid",
                status as "status!: ExecutionProcessStatus",
                completed_at as "completed_at?: DateTime<Utc>"
            FROM (
                SELECT
                    s.workspace_id,
                    ep.id as execution_process_id,
                    ep.session_id,
                    ep.status,
                    ep.completed_at,
                    ROW_NUMBER() OVER (
                        PARTITION BY s.workspace_id
                        ORDER BY ep.created_at DESC
                    ) as rn
                FROM execution_processes ep
                JOIN sessions s ON ep.session_id = s.id
                JOIN workspaces w ON s.workspace_id = w.id
                WHERE w.archived = $1
                  AND ep.run_reason IN ('setupscript', 'cleanupscript', 'archivescript')
                  AND ep.dropped = FALSE
            )
            WHERE rn = 1
            "#,
        )
        .bind(archived)
        .fetch_all(pool)
        .await?;

        let result = rows
            .into_iter()
            .map(|info| (info.workspace_id, info))
            .collect();

        Ok(result)
    }

    /// Find all workspaces with running dev servers, filtered by archived status.
    /// Returns a set of workspace IDs that have at least one running dev server.
    pub async fn find_workspaces_with_running_dev_servers(
        pool: &SqlitePool,
        archived: bool,
    ) -> Result<HashSet<Uuid>, sqlx::Error> {
        let rows: Vec<Uuid> = sqlx::query_scalar!(
            r#"
            SELECT DISTINCT s.workspace_id as "workspace_id!: Uuid"
            FROM execution_processes ep
            JOIN sessions s ON ep.session_id = s.id
            JOIN workspaces w ON s.workspace_id = w.id
            WHERE w.archived = $1
              AND ep.status = 'running'
              AND ep.run_reason = 'devserver'
            "#,
            archived
        )
        .fetch_all(pool)
        .await?;

        Ok(rows.into_iter().collect())
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use executors::actions::{
        ExecutorAction, ExecutorActionType,
        script::{ScriptContext, ScriptRequest, ScriptRequestLanguage},
    };
    use serde_json::Value;
    use uuid::Uuid;

    use super::*;

    fn process(
        run_reason: ExecutionProcessRunReason,
        status: ExecutionProcessStatus,
    ) -> ExecutionProcess {
        let now = Utc::now();

        ExecutionProcess {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            run_reason,
            executor_action: sqlx::types::Json(ExecutorActionField::ExecutorAction(
                ExecutorAction::new(
                    ExecutorActionType::ScriptRequest(ScriptRequest {
                        script: "echo test".to_string(),
                        language: ScriptRequestLanguage::Bash,
                        context: ScriptContext::SetupScript,
                        working_dir: None,
                    }),
                    None,
                ),
            )),
            status,
            exit_code: None,
            dropped: false,
            started_at: now,
            completed_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    fn view_value(run_reason: ExecutionProcessRunReason, status: ExecutionProcessStatus) -> Value {
        serde_json::to_value(ExecutionProcessView::from_process(process(
            run_reason, status,
        )))
        .expect("execution process view should serialize")
    }

    #[test]
    fn script_process_view_has_no_agent_runtime_projection() {
        let value = view_value(
            ExecutionProcessRunReason::SetupScript,
            ExecutionProcessStatus::Running,
        );

        assert!(value.get("agent_runtime_lifecycle").is_none());
        assert!(value.get("agent_runtime_error").is_none());
    }
}
