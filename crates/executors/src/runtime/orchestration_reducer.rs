use super::{
    ContractVersionError, ORCHESTRATION_REDUCER_VERSION, ORCHESTRATION_STATE_SCHEMA_VERSION,
    OrchestrationEventEnvelope, OrchestrationEventPayload, OrchestrationState, ProjectionStatus,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrchestrationReducerApply {
    Applied,
    AppliedDegraded,
    Duplicate,
    IgnoredTerminalRegression,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum OrchestrationReducerError {
    #[error(transparent)]
    EventVersion(#[from] ContractVersionError),
    #[error("event belongs to a different orchestration run")]
    IdentityMismatch,
    #[error("orchestration event sequence must be greater than zero")]
    InvalidStreamPosition,
    #[error(
        "orchestration event sequence {received} conflicts with last applied sequence {last_applied}"
    )]
    SequenceConflict { received: u64, last_applied: u64 },
    #[error("orchestration state schema version {0} is not supported")]
    UnsupportedStateSchema(u16),
    #[error("orchestration reducer version {0} is not supported")]
    UnsupportedReducerVersion(u16),
}

pub fn reduce_orchestration_event(
    state: &mut OrchestrationState,
    event: &OrchestrationEventEnvelope,
) -> Result<OrchestrationReducerApply, OrchestrationReducerError> {
    validate_state(state)?;
    if let Err(error) = event.validate_for_projection() {
        state.projection_status = ProjectionStatus::ProjectionDegraded;
        return Err(error.into());
    }
    if state.orchestration_run_id != event.orchestration_run_id {
        return Err(OrchestrationReducerError::IdentityMismatch);
    }
    if event.sequence == 0 {
        state.projection_status = ProjectionStatus::ProjectionDegraded;
        return Err(OrchestrationReducerError::InvalidStreamPosition);
    }
    if event.sequence <= state.last_event_sequence {
        return if event.sequence == state.last_event_sequence
            && state.last_event_id == Some(event.event_id)
        {
            Ok(OrchestrationReducerApply::Duplicate)
        } else {
            state.projection_status = ProjectionStatus::ProjectionDegraded;
            Err(OrchestrationReducerError::SequenceConflict {
                received: event.sequence,
                last_applied: state.last_event_sequence,
            })
        };
    }

    let had_gap = event.sequence != state.last_event_sequence + 1;
    if had_gap {
        state.projection_status = ProjectionStatus::ProjectionDegraded;
    }

    let apply = match &event.payload {
        OrchestrationEventPayload::LifecycleChanged { status } => {
            if state.status.is_terminal() && !status.is_terminal() {
                OrchestrationReducerApply::IgnoredTerminalRegression
            } else {
                state.status = *status;
                OrchestrationReducerApply::Applied
            }
        }
        OrchestrationEventPayload::ProjectionDegraded { .. }
        | OrchestrationEventPayload::Unknown { .. } => {
            if matches!(&event.payload, OrchestrationEventPayload::Unknown { .. }) {
                state.unknown_event_count += 1;
            }
            state.projection_status = ProjectionStatus::ProjectionDegraded;
            OrchestrationReducerApply::AppliedDegraded
        }
        OrchestrationEventPayload::NodeStatusChanged { .. }
        | OrchestrationEventPayload::AgentRunLinked { .. }
        | OrchestrationEventPayload::JoinDecided { .. }
        | OrchestrationEventPayload::CommandQueued { .. } => OrchestrationReducerApply::Applied,
    };

    state.last_event_sequence = event.sequence;
    state.last_event_id = Some(event.event_id);
    state.updated_at = event.timestamp;

    if had_gap || state.projection_status == ProjectionStatus::ProjectionDegraded {
        Ok(match apply {
            OrchestrationReducerApply::Duplicate
            | OrchestrationReducerApply::IgnoredTerminalRegression => apply,
            _ => OrchestrationReducerApply::AppliedDegraded,
        })
    } else {
        Ok(apply)
    }
}

fn validate_state(state: &OrchestrationState) -> Result<(), OrchestrationReducerError> {
    if state.state_schema_version != ORCHESTRATION_STATE_SCHEMA_VERSION {
        return Err(OrchestrationReducerError::UnsupportedStateSchema(
            state.state_schema_version,
        ));
    }
    if state.reducer_version != ORCHESTRATION_REDUCER_VERSION {
        return Err(OrchestrationReducerError::UnsupportedReducerVersion(
            state.reducer_version,
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use serde_json::json;
    use uuid::Uuid;

    use super::*;

    fn event(
        run_id: Uuid,
        sequence: u64,
        payload: OrchestrationEventPayload,
    ) -> OrchestrationEventEnvelope {
        OrchestrationEventEnvelope {
            schema_version: 1,
            payload_version: 1,
            event_id: Uuid::new_v4(),
            orchestration_run_id: run_id,
            sequence,
            correlation_id: Uuid::new_v4(),
            timestamp: Utc::now(),
            payload,
        }
    }

    #[test]
    fn reducer_handles_gap_duplicate_and_terminal_regression() {
        let run_id = Uuid::new_v4();
        let now = Utc::now();
        let mut state = OrchestrationState::pending(run_id, now);
        let running = event(
            run_id,
            2,
            OrchestrationEventPayload::LifecycleChanged {
                status: super::super::OrchestrationRunStatus::Running,
            },
        );
        assert_eq!(
            reduce_orchestration_event(&mut state, &running).unwrap(),
            OrchestrationReducerApply::AppliedDegraded
        );
        assert_eq!(
            reduce_orchestration_event(&mut state, &running).unwrap(),
            OrchestrationReducerApply::Duplicate
        );

        let terminal = event(
            run_id,
            3,
            OrchestrationEventPayload::LifecycleChanged {
                status: super::super::OrchestrationRunStatus::Succeeded,
            },
        );
        assert_eq!(
            reduce_orchestration_event(&mut state, &terminal).unwrap(),
            OrchestrationReducerApply::AppliedDegraded
        );
        let late = event(
            run_id,
            4,
            OrchestrationEventPayload::LifecycleChanged {
                status: super::super::OrchestrationRunStatus::Running,
            },
        );
        assert_eq!(
            reduce_orchestration_event(&mut state, &late).unwrap(),
            OrchestrationReducerApply::IgnoredTerminalRegression
        );
        assert_eq!(
            state.status,
            super::super::OrchestrationRunStatus::Succeeded
        );
    }

    #[test]
    fn unknown_event_is_preserved_as_degraded() {
        let run_id = Uuid::new_v4();
        let mut state = OrchestrationState::pending(run_id, Utc::now());
        let event = event(
            run_id,
            1,
            OrchestrationEventPayload::Unknown {
                event_type: "future".to_string(),
                payload: json!({ "value": 1 }),
            },
        );
        assert_eq!(
            reduce_orchestration_event(&mut state, &event).unwrap(),
            OrchestrationReducerApply::AppliedDegraded
        );
        assert_eq!(state.unknown_event_count, 1);
    }
}
