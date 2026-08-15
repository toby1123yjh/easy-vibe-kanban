//! Process-side facts used by restart reconciliation.
//!
//! This module intentionally contains no Runtime state mutation, retry
//! decision, registry write, or process termination. Those effects belong to
//! the owning service and explicit control paths.

use std::time::SystemTime;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SupervisedProcess {
    pub pid: u32,
    pub process_group_id: Option<u32>,
    pub started_at: Option<SystemTime>,
    pub command_preview: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProcessObservation {
    Alive,
    Exited(Option<i64>),
    TemporarilyUnreachable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ReconciliationAction {
    Attach,
    ObserveReadOnly,
    ConfirmExit,
    PreserveForRetry,
}

/// Restart reconciliation is observational. A caller must make retry,
/// replacement, failure, and kill decisions from Runtime Core state or an
/// explicit policy command.
pub(crate) const fn reconciliation_action(
    observation: ProcessObservation,
    has_live_handle: bool,
) -> ReconciliationAction {
    match (observation, has_live_handle) {
        (ProcessObservation::Alive, true) => ReconciliationAction::Attach,
        (ProcessObservation::Alive, false) => ReconciliationAction::ObserveReadOnly,
        (ProcessObservation::Exited(_), _) => ReconciliationAction::ConfirmExit,
        (ProcessObservation::TemporarilyUnreachable, _) => ReconciliationAction::PreserveForRetry,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restart_reconciliation_never_defaults_to_kill_or_failure() {
        assert_eq!(
            reconciliation_action(ProcessObservation::Alive, true),
            ReconciliationAction::Attach
        );
        assert_eq!(
            reconciliation_action(ProcessObservation::Alive, false),
            ReconciliationAction::ObserveReadOnly
        );
        assert_eq!(
            reconciliation_action(ProcessObservation::Exited(Some(0)), false),
            ReconciliationAction::ConfirmExit
        );
        assert_eq!(
            reconciliation_action(ProcessObservation::TemporarilyUnreachable, false),
            ReconciliationAction::PreserveForRetry
        );
    }
}
