use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder, Sqlite, SqliteConnection, SqlitePool, Type};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "task_execution_kind", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum TaskExecutionKind {
    Agent,
    Workflow,
    Arena,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum TaskStatus {
    Draft,
    Pending,
    Running,
    Waiting,
    Succeeded,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(tag = "kind", rename_all = "snake_case")]
pub enum TaskOpenTarget {
    Agent {
        session_id: Uuid,
        workspace_id: Uuid,
    },
    Workflow {
        attempt_id: Uuid,
        workflow_id: Uuid,
        latest_run_id: Option<Uuid>,
    },
    Arena {
        arena_group_id: Uuid,
    },
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct Task {
    pub id: Uuid,
    pub project_id: Uuid,
    pub issue_id: Uuid,
    pub parent_task_id: Option<Uuid>,
    pub title: String,
    pub execution_kind: TaskExecutionKind,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone)]
pub struct CreateTask {
    pub id: Uuid,
    pub project_id: Uuid,
    pub issue_id: Uuid,
    pub parent_task_id: Option<Uuid>,
    pub title: String,
    pub execution_kind: TaskExecutionKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct TaskSummary {
    pub id: Uuid,
    pub project_id: Uuid,
    pub issue_id: Uuid,
    pub parent_task_id: Option<Uuid>,
    pub title: String,
    pub execution_kind: TaskExecutionKind,
    pub status: TaskStatus,
    pub open_target: TaskOpenTarget,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct TaskCursor {
    pub updated_at: DateTime<Utc>,
    pub id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct TaskSummaryPage {
    pub tasks: Vec<TaskSummary>,
    pub next_cursor: Option<TaskCursor>,
}

#[derive(Debug, Error)]
pub enum TaskError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("Task title must not be empty")]
    EmptyTitle,
    #[error("Task {task_id} has an invalid execution binding: {detail}")]
    InvalidBinding { task_id: Uuid, detail: String },
    #[error("Task runtime returned an unsupported status `{status}`")]
    InvalidRuntimeStatus { status: String },
    #[error("Task {task_id} was not found")]
    NotFound { task_id: Uuid },
}

#[derive(Debug, FromRow)]
struct TaskProjectionRow {
    id: Uuid,
    project_id: Uuid,
    issue_id: Uuid,
    parent_task_id: Option<Uuid>,
    title: String,
    execution_kind: TaskExecutionKind,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    agent_session_id: Option<Uuid>,
    agent_workspace_id: Option<Uuid>,
    workflow_attempt_id: Option<Uuid>,
    workflow_id: Option<Uuid>,
    latest_run_id: Option<Uuid>,
    arena_group_id: Option<Uuid>,
    runtime_status: Option<String>,
}

const TASK_SUMMARY_SELECT: &str = r#"
    WITH latest_session_run AS (
        SELECT run.session_id,
               state.status,
               ROW_NUMBER() OVER (
                   PARTITION BY run.session_id
                   ORDER BY run.updated_at DESC, run.id ASC
               ) AS row_number
        FROM agent_runs run
        JOIN agent_run_state state ON state.agent_run_id = run.id
    ),
    latest_candidate_run AS (
        SELECT candidate.arena_group_id,
               state.status,
               ROW_NUMBER() OVER (
                   PARTITION BY candidate.arena_group_id, candidate.workspace_id
                   ORDER BY run.updated_at DESC, run.id ASC
               ) AS workspace_row_number
        FROM arena_candidates candidate
        JOIN agent_runs run ON run.workspace_id = candidate.workspace_id
        JOIN agent_run_state state ON state.agent_run_id = run.id
    ),
    arena_runtime AS (
        SELECT group_row.id AS arena_group_id,
               CASE
                   WHEN group_row.winner_candidate_id IS NOT NULL THEN 'succeeded'
                   WHEN group_row.lifecycle_status = 'closed' THEN 'cancelled'
                   WHEN SUM(CASE WHEN candidate_run.status IN (
                       'pending','starting','running','awaiting_input',
                       'awaiting_approval','cancelling'
                   ) THEN 1 ELSE 0 END) > 0 THEN 'running'
                   WHEN SUM(CASE WHEN candidate_run.status IN (
                       'failed','crashed','audit_failed'
                   ) THEN 1 ELSE 0 END) > 0
                    AND SUM(CASE WHEN candidate_run.status = 'succeeded'
                        THEN 1 ELSE 0 END) = 0 THEN 'failed'
                   WHEN SUM(CASE WHEN candidate_run.status = 'succeeded'
                       THEN 1 ELSE 0 END) > 0 THEN 'awaiting_arena'
                   WHEN SUM(CASE WHEN candidate_run.status IN (
                       'cancelled','canceled'
                   ) THEN 1 ELSE 0 END) > 0 THEN 'cancelled'
                   ELSE 'pending'
               END AS status
        FROM arena_groups group_row
        LEFT JOIN latest_candidate_run candidate_run
          ON candidate_run.arena_group_id = group_row.id
         AND candidate_run.workspace_row_number = 1
        GROUP BY group_row.id, group_row.lifecycle_status,
                 group_row.winner_candidate_id
    )
    SELECT task.id,
           task.project_id,
           task.issue_id,
           task.parent_task_id,
           task.title,
           task.execution_kind,
           task.created_at,
           task.updated_at,
           agent.session_id AS agent_session_id,
           session.workspace_id AS agent_workspace_id,
           workflow.id AS workflow_attempt_id,
           workflow.workflow_id,
           workflow.latest_run_id,
           arena.id AS arena_group_id,
           CASE task.execution_kind
               WHEN 'agent' THEN COALESCE(agent_run.status, 'pending')
               WHEN 'workflow' THEN workflow.status
               WHEN 'arena' THEN arena_runtime.status
           END AS runtime_status
    FROM tasks task
    LEFT JOIN agent_task_bindings agent ON agent.task_id = task.id
    LEFT JOIN sessions session ON session.id = agent.session_id
    LEFT JOIN latest_session_run agent_run
      ON agent_run.session_id = agent.session_id
     AND agent_run.row_number = 1
    LEFT JOIN workflow_attempts workflow ON workflow.task_id = task.id
    LEFT JOIN arena_groups arena ON arena.task_id = task.id
    LEFT JOIN arena_runtime ON arena_runtime.arena_group_id = arena.id
"#;

impl TaskProjectionRow {
    fn into_summary(self) -> Result<TaskSummary, TaskError> {
        let status = map_runtime_status(self.runtime_status.as_deref().unwrap_or("pending"))?;
        let open_target = match self.execution_kind {
            TaskExecutionKind::Agent => {
                let (Some(session_id), Some(workspace_id)) =
                    (self.agent_session_id, self.agent_workspace_id)
                else {
                    return Err(TaskError::InvalidBinding {
                        task_id: self.id,
                        detail: "agent Task requires exactly one Session binding".to_string(),
                    });
                };
                if self.workflow_attempt_id.is_some() || self.arena_group_id.is_some() {
                    return Err(TaskError::InvalidBinding {
                        task_id: self.id,
                        detail: "agent Task has more than one subtype binding".to_string(),
                    });
                }
                TaskOpenTarget::Agent {
                    session_id,
                    workspace_id,
                }
            }
            TaskExecutionKind::Workflow => {
                let (Some(attempt_id), Some(workflow_id)) =
                    (self.workflow_attempt_id, self.workflow_id)
                else {
                    return Err(TaskError::InvalidBinding {
                        task_id: self.id,
                        detail: "workflow Task requires exactly one WorkflowAttempt binding"
                            .to_string(),
                    });
                };
                if self.agent_session_id.is_some() || self.arena_group_id.is_some() {
                    return Err(TaskError::InvalidBinding {
                        task_id: self.id,
                        detail: "workflow Task has more than one subtype binding".to_string(),
                    });
                }
                TaskOpenTarget::Workflow {
                    attempt_id,
                    workflow_id,
                    latest_run_id: self.latest_run_id,
                }
            }
            TaskExecutionKind::Arena => {
                let Some(arena_group_id) = self.arena_group_id else {
                    return Err(TaskError::InvalidBinding {
                        task_id: self.id,
                        detail: "arena Task requires exactly one ArenaGroup binding".to_string(),
                    });
                };
                if self.agent_session_id.is_some() || self.workflow_attempt_id.is_some() {
                    return Err(TaskError::InvalidBinding {
                        task_id: self.id,
                        detail: "arena Task has more than one subtype binding".to_string(),
                    });
                }
                TaskOpenTarget::Arena { arena_group_id }
            }
        };

        Ok(TaskSummary {
            id: self.id,
            project_id: self.project_id,
            issue_id: self.issue_id,
            parent_task_id: self.parent_task_id,
            title: self.title,
            execution_kind: self.execution_kind,
            status,
            open_target,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

fn map_runtime_status(status: &str) -> Result<TaskStatus, TaskError> {
    match status {
        "draft" => Ok(TaskStatus::Draft),
        "ready" | "pending" | "starting" => Ok(TaskStatus::Pending),
        "running" | "cancelling" => Ok(TaskStatus::Running),
        "awaiting_input" | "awaiting_approval" | "awaiting_human" | "awaiting_arena" => {
            Ok(TaskStatus::Waiting)
        }
        "succeeded" => Ok(TaskStatus::Succeeded),
        "failed" | "crashed" | "audit_failed" => Ok(TaskStatus::Failed),
        "cancelled" | "canceled" => Ok(TaskStatus::Cancelled),
        other => Err(TaskError::InvalidRuntimeStatus {
            status: other.to_string(),
        }),
    }
}

impl Task {
    pub async fn create(
        connection: &mut SqliteConnection,
        data: &CreateTask,
    ) -> Result<Self, TaskError> {
        let title = data.title.trim();
        if title.is_empty() {
            return Err(TaskError::EmptyTitle);
        }

        Ok(sqlx::query_as::<_, Task>(
            r#"
            INSERT INTO tasks (
                id, project_id, issue_id, parent_task_id, title, execution_kind
            ) VALUES (?, ?, ?, ?, ?, ?)
            RETURNING id, project_id, issue_id, parent_task_id, title,
                      execution_kind, created_at, updated_at
            "#,
        )
        .bind(data.id)
        .bind(data.project_id)
        .bind(data.issue_id)
        .bind(data.parent_task_id)
        .bind(title)
        .bind(data.execution_kind)
        .fetch_one(connection)
        .await?)
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, TaskError> {
        Ok(sqlx::query_as::<_, Task>(
            r#"
            SELECT id, project_id, issue_id, parent_task_id, title,
                   execution_kind, created_at, updated_at
            FROM tasks
            WHERE id = ?
            "#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await?)
    }

    pub async fn create_agent_task(
        pool: &SqlitePool,
        data: &CreateTask,
        session_id: Uuid,
    ) -> Result<Self, TaskError> {
        if data.execution_kind != TaskExecutionKind::Agent {
            return Err(TaskError::InvalidBinding {
                task_id: data.id,
                detail: "create_agent_task requires execution_kind=agent".to_string(),
            });
        }

        let mut transaction = pool.begin().await?;
        let task = Self::create(&mut transaction, data).await?;
        Self::bind_agent_session(&mut transaction, task.id, session_id).await?;
        transaction.commit().await?;
        Ok(task)
    }

    pub async fn find_agent_by_session_id(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<Option<Self>, TaskError> {
        Ok(sqlx::query_as::<_, Task>(
            r#"
            SELECT task.id, task.project_id, task.issue_id,
                   task.parent_task_id, task.title, task.execution_kind,
                   task.created_at, task.updated_at
            FROM agent_task_bindings binding
            JOIN tasks task ON task.id = binding.task_id
            WHERE binding.session_id = ?
            "#,
        )
        .bind(session_id)
        .fetch_optional(pool)
        .await?)
    }

    pub async fn find_agent_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Option<Self>, TaskError> {
        Ok(sqlx::query_as::<_, Task>(
            r#"
            SELECT task.id, task.project_id, task.issue_id,
                   task.parent_task_id, task.title, task.execution_kind,
                   task.created_at, task.updated_at
            FROM sessions session
            JOIN agent_task_bindings binding ON binding.session_id = session.id
            JOIN tasks task ON task.id = binding.task_id
            WHERE session.workspace_id = ?
            ORDER BY session.updated_at DESC, session.id ASC
            LIMIT 1
            "#,
        )
        .bind(workspace_id)
        .fetch_optional(pool)
        .await?)
    }

    pub async fn delete_agent_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<u64, TaskError> {
        let result = sqlx::query(
            r#"
            DELETE FROM tasks
            WHERE execution_kind = 'agent'
              AND id IN (
                  SELECT binding.task_id
                  FROM agent_task_bindings binding
                  JOIN sessions session ON session.id = binding.session_id
                  WHERE session.workspace_id = ?
              )
            "#,
        )
        .bind(workspace_id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected())
    }

    pub async fn summary_by_id(
        pool: &SqlitePool,
        id: Uuid,
    ) -> Result<Option<TaskSummary>, TaskError> {
        let sql = format!("{TASK_SUMMARY_SELECT} WHERE task.id = ?");
        let row = sqlx::query_as::<_, TaskProjectionRow>(&sql)
            .bind(id)
            .fetch_optional(pool)
            .await?;
        row.map(TaskProjectionRow::into_summary).transpose()
    }

    pub async fn list_top_level(
        pool: &SqlitePool,
        project_id: Uuid,
        issue_id: Option<Uuid>,
        cursor: Option<TaskCursor>,
        limit: u32,
    ) -> Result<TaskSummaryPage, TaskError> {
        let page_size = limit.clamp(1, 100) as i64;
        let mut query = QueryBuilder::<Sqlite>::new(TASK_SUMMARY_SELECT);
        query
            .push(" WHERE task.project_id = ")
            .push_bind(project_id);
        query.push(" AND task.parent_task_id IS NULL");
        if let Some(issue_id) = issue_id {
            query.push(" AND task.issue_id = ").push_bind(issue_id);
        }
        if let Some(cursor) = cursor {
            query
                .push(" AND (julianday(task.updated_at) < julianday(")
                .push_bind(cursor.updated_at)
                .push(") OR (julianday(task.updated_at) = julianday(")
                .push_bind(cursor.updated_at)
                .push(") AND task.id > ")
                .push_bind(cursor.id)
                .push("))");
        }
        query
            .push(" ORDER BY julianday(task.updated_at) DESC, task.id ASC LIMIT ")
            .push_bind(page_size + 1);

        let mut rows = query
            .build_query_as::<TaskProjectionRow>()
            .fetch_all(pool)
            .await?;
        let has_more = rows.len() > page_size as usize;
        if has_more {
            rows.pop();
        }
        let tasks = rows
            .into_iter()
            .map(TaskProjectionRow::into_summary)
            .collect::<Result<Vec<_>, _>>()?;
        let next_cursor = has_more.then(|| {
            let last = tasks
                .last()
                .expect("a paginated page with more rows is non-empty");
            TaskCursor {
                updated_at: last.updated_at,
                id: last.id,
            }
        });

        Ok(TaskSummaryPage { tasks, next_cursor })
    }

    pub async fn list_children(
        pool: &SqlitePool,
        parent_task_id: Uuid,
        cursor: Option<TaskCursor>,
        limit: u32,
    ) -> Result<TaskSummaryPage, TaskError> {
        let page_size = limit.clamp(1, 100) as i64;
        let mut query = QueryBuilder::<Sqlite>::new(TASK_SUMMARY_SELECT);
        query
            .push(" WHERE task.parent_task_id = ")
            .push_bind(parent_task_id);
        if let Some(cursor) = cursor {
            query
                .push(" AND (julianday(task.updated_at) < julianday(")
                .push_bind(cursor.updated_at)
                .push(") OR (julianday(task.updated_at) = julianday(")
                .push_bind(cursor.updated_at)
                .push(") AND task.id > ")
                .push_bind(cursor.id)
                .push("))");
        }
        query
            .push(" ORDER BY julianday(task.updated_at) DESC, task.id ASC LIMIT ")
            .push_bind(page_size + 1);

        let mut rows = query
            .build_query_as::<TaskProjectionRow>()
            .fetch_all(pool)
            .await?;
        let has_more = rows.len() > page_size as usize;
        if has_more {
            rows.pop();
        }
        let tasks = rows
            .into_iter()
            .map(TaskProjectionRow::into_summary)
            .collect::<Result<Vec<_>, _>>()?;
        let next_cursor = has_more.then(|| {
            let last = tasks
                .last()
                .expect("a paginated child Task page with more rows is non-empty");
            TaskCursor {
                updated_at: last.updated_at,
                id: last.id,
            }
        });

        Ok(TaskSummaryPage { tasks, next_cursor })
    }

    pub async fn bind_agent_session(
        connection: &mut SqliteConnection,
        task_id: Uuid,
        session_id: Uuid,
    ) -> Result<(), TaskError> {
        sqlx::query("INSERT INTO agent_task_bindings (task_id, session_id) VALUES (?, ?)")
            .bind(task_id)
            .bind(session_id)
            .execute(connection)
            .await?;
        Ok(())
    }

    pub async fn update_title(
        pool: &SqlitePool,
        task_id: Uuid,
        title: &str,
    ) -> Result<bool, TaskError> {
        let title = title.trim();
        if title.is_empty() {
            return Err(TaskError::EmptyTitle);
        }
        let result = sqlx::query(
            "UPDATE tasks SET title = ?, updated_at = datetime('now', 'subsec') WHERE id = ?",
        )
        .bind(title)
        .bind(task_id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_status_mapping_is_exhaustive_for_product_runtime_values() {
        for (value, expected) in [
            ("draft", TaskStatus::Draft),
            ("pending", TaskStatus::Pending),
            ("starting", TaskStatus::Pending),
            ("running", TaskStatus::Running),
            ("awaiting_input", TaskStatus::Waiting),
            ("awaiting_approval", TaskStatus::Waiting),
            ("awaiting_human", TaskStatus::Waiting),
            ("awaiting_arena", TaskStatus::Waiting),
            ("cancelling", TaskStatus::Running),
            ("succeeded", TaskStatus::Succeeded),
            ("failed", TaskStatus::Failed),
            ("cancelled", TaskStatus::Cancelled),
            ("canceled", TaskStatus::Cancelled),
            ("crashed", TaskStatus::Failed),
            ("audit_failed", TaskStatus::Failed),
        ] {
            assert_eq!(map_runtime_status(value).unwrap(), expected);
        }
        assert!(map_runtime_status("guessed_from_logs").is_err());
    }
}
