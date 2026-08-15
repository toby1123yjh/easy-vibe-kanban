use db::models::{
    agent_runtime::{
        AgentRunLaunchGateRecord, AgentRunLaunchGateStatus, AgentRuntimePersistenceError,
    },
    execution_process::{ExecutionProcess, ExecutionProcessRunReason, ExecutionProcessStatus},
    session::Session,
    workspace::Workspace,
};
use deployment::Deployment;
use executors::actions::ExecutorAction;
use services::services::{
    container::ContainerService,
    execution_process::{ExecutionCompletedEvent, subscribe_execution_completed},
};
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

enum SetupStartError {
    Execution(ApiError),
    Persistence(ApiError),
}

fn persistence_api_error(error: AgentRuntimePersistenceError) -> ApiError {
    match error {
        AgentRuntimePersistenceError::Database(error) => ApiError::Database(error),
        other => ApiError::BadGateway(other.to_string()),
    }
}

fn setup_terminal_outcome(process: &ExecutionProcess) -> Option<Result<(), String>> {
    if process.run_reason != ExecutionProcessRunReason::SetupScript {
        return None;
    }

    match &process.status {
        ExecutionProcessStatus::Running => return None,
        ExecutionProcessStatus::Failed | ExecutionProcessStatus::Killed => {
            return Some(Err(format!(
                "setup process {} ended with status {:?}",
                process.id, process.status
            )));
        }
        ExecutionProcessStatus::Completed => {}
    }

    if process.exit_code != Some(0) {
        return Some(Err(format!(
            "setup process {} completed with exit code {:?}",
            process.id, process.exit_code
        )));
    }

    match process.executor_action() {
        Ok(action) if action.next_action().is_some() => None,
        Ok(_) => Some(Ok(())),
        Err(error) => Some(Err(format!(
            "setup process {} has an invalid action: {error}",
            process.id
        ))),
    }
}

async fn gate_context(
    deployment: &DeploymentImpl,
    gate: &AgentRunLaunchGateRecord,
) -> Result<(Session, Workspace), ApiError> {
    let session_id: Option<Uuid> =
        sqlx::query_scalar("SELECT session_id FROM agent_runs WHERE id = ?")
            .bind(gate.agent_run_id)
            .fetch_optional(&deployment.db().pool)
            .await?;
    let session_id = session_id.ok_or_else(|| {
        ApiError::BadGateway(format!(
            "setup gate references missing AgentRun {}",
            gate.agent_run_id
        ))
    })?;
    let session = Session::find_by_id(&deployment.db().pool, session_id)
        .await?
        .ok_or_else(|| {
            ApiError::BadGateway(format!(
                "setup gate AgentRun {} references missing session {session_id}",
                gate.agent_run_id
            ))
        })?;
    let workspace = Workspace::find_by_id(&deployment.db().pool, session.workspace_id)
        .await?
        .ok_or_else(|| {
            ApiError::BadGateway(format!(
                "setup gate AgentRun {} references missing workspace {}",
                gate.agent_run_id, session.workspace_id
            ))
        })?;
    Ok((session, workspace))
}

async fn catch_up_terminal_outcome(
    deployment: &DeploymentImpl,
    gate: &AgentRunLaunchGateRecord,
) -> Result<Option<Result<(), String>>, ApiError> {
    let (session, _) = gate_context(deployment, gate).await?;
    let processes =
        ExecutionProcess::find_by_session_id(&deployment.db().pool, session.id, false).await?;
    Ok(processes
        .iter()
        .rev()
        .filter(|process| process.created_at >= gate.created_at)
        .find_map(setup_terminal_outcome))
}

async fn ensure_setup_started(
    deployment: &DeploymentImpl,
    gate: &AgentRunLaunchGateRecord,
) -> Result<(), SetupStartError> {
    if gate.setup_execution_process_id.is_some() {
        return Ok(());
    }

    if let Some(process_id) = gate
        .find_unattached_setup_process(&deployment.db().pool)
        .await
        .map_err(|error| SetupStartError::Persistence(ApiError::Database(error)))?
    {
        AgentRunLaunchGateRecord::attach_setup_process(
            &deployment.db().pool,
            gate.agent_run_id,
            process_id,
        )
        .await
        .map_err(|error| SetupStartError::Persistence(persistence_api_error(error)))?;
        return Ok(());
    }

    let (session, workspace) = gate_context(deployment, gate)
        .await
        .map_err(SetupStartError::Persistence)?;
    let process = deployment
        .container()
        .start_execution(
            &workspace,
            &session,
            &gate.setup_action.0,
            &ExecutionProcessRunReason::SetupScript,
        )
        .await
        .map_err(|error| SetupStartError::Execution(error.into()))?;
    AgentRunLaunchGateRecord::attach_setup_process(
        &deployment.db().pool,
        gate.agent_run_id,
        process.id,
    )
    .await
    .map_err(|error| SetupStartError::Persistence(persistence_api_error(error)))
}

async fn fail_gate_and_reserved_run(
    deployment: &DeploymentImpl,
    agent_run_id: Uuid,
    message: String,
) -> Result<(), ApiError> {
    AgentRunLaunchGateRecord::mark_failed(&deployment.db().pool, agent_run_id, &message)
        .await
        .map_err(persistence_api_error)?;
    super::fail_reserved_coding_agent_execution(deployment, agent_run_id, message).await?;
    Ok(())
}

async fn satisfy_gate_and_launch(
    deployment: &DeploymentImpl,
    agent_run_id: Uuid,
) -> Result<(), ApiError> {
    AgentRunLaunchGateRecord::mark_satisfied(&deployment.db().pool, agent_run_id)
        .await
        .map_err(persistence_api_error)?;
    super::launch_reserved_coding_agent_execution(deployment, agent_run_id).await?;
    Ok(())
}

async fn reconcile_gate(
    deployment: &DeploymentImpl,
    mut gate: AgentRunLaunchGateRecord,
) -> Result<(), ApiError> {
    match gate.gate_status {
        AgentRunLaunchGateStatus::WaitingSetupStart => {
            match ensure_setup_started(deployment, &gate).await {
                Ok(()) => {}
                Err(SetupStartError::Execution(error)) => {
                    let message = format!("setup process failed to start: {error}");
                    fail_gate_and_reserved_run(deployment, gate.agent_run_id, message).await?;
                    return Ok(());
                }
                Err(SetupStartError::Persistence(error)) => return Err(error),
            }
            gate = AgentRunLaunchGateRecord::find(&deployment.db().pool, gate.agent_run_id)
                .await?
                .ok_or_else(|| {
                    ApiError::BadGateway(format!(
                        "setup gate disappeared for AgentRun {}",
                        gate.agent_run_id
                    ))
                })?;
        }
        AgentRunLaunchGateStatus::WaitingSetup => {}
        AgentRunLaunchGateStatus::Satisfied => {
            super::launch_reserved_coding_agent_execution(deployment, gate.agent_run_id).await?;
            return Ok(());
        }
        AgentRunLaunchGateStatus::Failed => {
            let message = gate
                .failure_message
                .clone()
                .unwrap_or_else(|| "setup gate failed".to_string());
            super::fail_reserved_coding_agent_execution(deployment, gate.agent_run_id, message)
                .await?;
            return Ok(());
        }
    }

    match catch_up_terminal_outcome(deployment, &gate).await? {
        Some(Ok(())) => satisfy_gate_and_launch(deployment, gate.agent_run_id).await,
        Some(Err(message)) => {
            fail_gate_and_reserved_run(deployment, gate.agent_run_id, message).await
        }
        None => Ok(()),
    }
}

pub(crate) async fn start_reserved_after_setup(
    deployment: &DeploymentImpl,
    agent_run_id: Uuid,
    setup_action: &ExecutorAction,
) -> Result<(), ApiError> {
    let gate =
        match AgentRunLaunchGateRecord::create(&deployment.db().pool, agent_run_id, setup_action)
            .await
        {
            Ok(gate) => gate,
            Err(error) => {
                let message = format!("failed to persist setup launch gate: {error}");
                let _ = super::fail_reserved_coding_agent_execution(
                    deployment,
                    agent_run_id,
                    message.clone(),
                )
                .await;
                return Err(persistence_api_error(error));
            }
        };
    reconcile_gate(deployment, gate).await
}

async fn reconcile_completion_event(
    deployment: &DeploymentImpl,
    event: ExecutionCompletedEvent,
) -> Result<(), ApiError> {
    let Some(process) =
        ExecutionProcess::find_by_id(&deployment.db().pool, event.execution_process_id).await?
    else {
        return Ok(());
    };
    if process.run_reason != ExecutionProcessRunReason::SetupScript {
        return Ok(());
    }
    let Some(gate) =
        AgentRunLaunchGateRecord::find_for_session(&deployment.db().pool, event.session_id).await?
    else {
        return Ok(());
    };
    reconcile_gate(deployment, gate).await
}

pub async fn reconcile_setup_launch_gates(deployment: &DeploymentImpl) -> Result<usize, ApiError> {
    let gates = AgentRunLaunchGateRecord::find_reconcilable(&deployment.db().pool).await?;
    let gate_count = gates.len();
    for gate in gates {
        let agent_run_id = gate.agent_run_id;
        if let Err(error) = reconcile_gate(deployment, gate).await {
            tracing::error!(
                %agent_run_id,
                %error,
                "failed to reconcile durable setup launch gate"
            );
        }
    }
    Ok(gate_count)
}

pub fn spawn_setup_launch_gate_watcher(deployment: DeploymentImpl) {
    let mut completions = subscribe_execution_completed();
    tokio::spawn(async move {
        loop {
            match completions.recv().await {
                Ok(event) => {
                    if let Err(error) = reconcile_completion_event(&deployment, event).await {
                        tracing::error!(%error, "failed to reconcile setup completion event");
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::warn!(
                        skipped,
                        "setup launch gate watcher lagged; catching up from durable state"
                    );
                    if let Err(error) = reconcile_setup_launch_gates(&deployment).await {
                        tracing::error!(%error, "failed to catch up setup launch gates");
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use db::models::execution_process::ExecutorActionField;
    use executors::actions::{
        ExecutorActionType,
        script::{ScriptContext, ScriptRequest, ScriptRequestLanguage},
    };
    use sqlx::types::Json;

    use super::*;

    fn script_action(script: &str) -> ExecutorAction {
        ExecutorAction::new(
            ExecutorActionType::ScriptRequest(ScriptRequest {
                script: script.to_string(),
                language: ScriptRequestLanguage::Bash,
                context: ScriptContext::SetupScript,
                working_dir: Some("repo".to_string()),
            }),
            None,
        )
    }

    fn setup_process(
        status: ExecutionProcessStatus,
        exit_code: Option<i64>,
        has_next_action: bool,
    ) -> ExecutionProcess {
        let action = if has_next_action {
            script_action("first").append_action(script_action("last"))
        } else {
            script_action("last")
        };
        let now = Utc::now();
        ExecutionProcess {
            id: Uuid::new_v4(),
            session_id: Uuid::new_v4(),
            run_reason: ExecutionProcessRunReason::SetupScript,
            executor_action: Json(ExecutorActionField::ExecutorAction(action)),
            status,
            exit_code,
            dropped: false,
            started_at: now,
            completed_at: None,
            created_at: now,
            updated_at: now,
        }
    }

    #[test]
    fn setup_gate_waits_for_the_last_action_in_a_sequential_chain() {
        assert!(
            setup_terminal_outcome(&setup_process(ExecutionProcessStatus::Running, None, false,))
                .is_none()
        );
        assert!(
            setup_terminal_outcome(&setup_process(
                ExecutionProcessStatus::Completed,
                Some(0),
                true,
            ))
            .is_none()
        );
        assert!(matches!(
            setup_terminal_outcome(&setup_process(
                ExecutionProcessStatus::Completed,
                Some(0),
                false,
            )),
            Some(Ok(()))
        ));
    }

    #[test]
    fn setup_gate_fails_closed_for_failed_killed_or_nonzero_processes() {
        for (status, exit_code) in [
            (ExecutionProcessStatus::Failed, Some(1)),
            (ExecutionProcessStatus::Killed, None),
            (ExecutionProcessStatus::Completed, Some(1)),
        ] {
            assert!(matches!(
                setup_terminal_outcome(&setup_process(status, exit_code, false)),
                Some(Err(_))
            ));
        }
    }
}
