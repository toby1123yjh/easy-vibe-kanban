use chrono::Utc;
use db::models::{
    session::{Session, SessionError},
    task::Task,
};
use deployment::Deployment;
use executors::runtime::{
    AgentRunPort, AgentRunPortCommand, AgentRunPortCommandEnvelope,
    ORCHESTRATION_COMMAND_SCHEMA_VERSION,
};
use services::services::agent_runtime::AgentRunCommandService;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Default, serde::Deserialize)]
pub struct DeleteSessionQuery {
    #[serde(default)]
    pub stop_running: bool,
    #[serde(default)]
    pub delete_managed_files: bool,
}

#[cfg(test)]
mod managed_file_defaults {
    #[test]
    fn deleting_session_never_removes_files_without_explicit_choice() {
        let query: super::DeleteSessionQuery =
            serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(!query.delete_managed_files);
        assert!(!query.stop_running);
    }
}

/// Called under the session queue gate. Never hold a DB transaction across
/// process I/O; final deletion repeats every guard in BEGIN IMMEDIATE.
pub(crate) async fn prepare_deletion(
    deployment: &DeploymentImpl,
    session_id: Uuid,
    task_id: Option<Uuid>,
    stop_running: bool,
) -> Result<(), ApiError> {
    let pool = &deployment.db().pool;
    let mut transaction = pool.begin_with("BEGIN IMMEDIATE").await?;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ?)")
        .bind(session_id)
        .fetch_one(&mut *transaction)
        .await?;
    if !exists {
        return Err(SessionError::NotFound.into());
    }
    if let Some(task_id) = task_id {
        Task::validate_agent_deletion(&mut transaction, task_id, session_id).await?;
    } else if let Some(task_id) = sqlx::query_scalar::<_, Uuid>(
        "SELECT task_id FROM agent_task_bindings WHERE session_id = ?",
    )
    .bind(session_id)
    .fetch_optional(&mut *transaction)
    .await?
    {
        return Err(SessionError::AgentTaskBound { task_id }.into());
    }
    Session::validate_deletion_dependencies(&mut transaction, session_id).await?;
    transaction.rollback().await?;

    let run_ids: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM agent_runs WHERE session_id = ? ORDER BY created_at")
            .bind(session_id)
            .fetch_all(pool)
            .await?;
    for run_id in run_ids {
        let port = deployment.agent_run_port();
        let mut state = port
            .query(run_id)
            .await
            .map_err(|error| ApiError::Conflict(error.to_string()))?;
        if !state.state.status.is_terminal() && stop_running {
            let command_id = Uuid::new_v4();
            AgentRunCommandService::new(pool, port)
                .dispatch(AgentRunPortCommandEnvelope {
                    schema_version: ORCHESTRATION_COMMAND_SCHEMA_VERSION,
                    command_id,
                    idempotency_key: format!("delete-session:{session_id}:{command_id}"),
                    agent_run_id: run_id,
                    orchestration_run_id: None,
                    orchestration_node_execution_id: None,
                    correlation_id: command_id,
                    created_at: Utc::now(),
                    command: AgentRunPortCommand::Cancel {
                        reason: "User confirmed stop and delete session".to_string(),
                    },
                })
                .await
                .map_err(|error| {
                    ApiError::Conflict(format!(
                        "Unable to stop agent; session was retained: {error}"
                    ))
                })?;
            // Cancel targets the current attempt once per run. Its acknowledgement
            // alone is not permission to delete: allow bounded projection lag.
            for _ in 0..20 {
                state = port
                    .query(run_id)
                    .await
                    .map_err(|error| ApiError::Conflict(error.to_string()))?;
                if state.state.status.is_terminal() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            if !state.state.status.is_terminal() {
                return Err(SessionError::ActiveAgentRun.into());
            }
        }
        let attempts: Vec<Uuid> = sqlx::query_scalar(
            "SELECT id FROM agent_run_attempts WHERE agent_run_id = ? AND status IN ('succeeded','failed','cancelled','crashed','audit_failed') ORDER BY created_at",
        ).bind(run_id).fetch_all(pool).await?;
        for attempt_id in attempts {
            let absent = port
                .reconcile_terminal_process(attempt_id)
                .await
                .map_err(|error| ApiError::Conflict(error.to_string()))?;
            if !absent && stop_running {
                port.stop_terminal_process_for_deletion(run_id, attempt_id)
                    .await
                    .map_err(|error| ApiError::Conflict(error.to_string()))?;
            }
        }
    }
    Ok(())
}
