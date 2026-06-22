use std::process::ExitStatus;

use db::models::execution_process::ExecutionProcessStatus;
use executors::{
    executors::ExecutorExitResult,
    runtime::{AgentRunLifecycle, AgentRuntimeError, AgentRuntimeErrorKind},
};

const EXECUTOR_SIGNAL_SUCCESS_EXIT_CODE: i64 = 0;
const EXECUTOR_SIGNAL_FAILURE_EXIT_CODE: i64 = 1;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct AgentRuntimeSupervisorOutcome {
    pub lifecycle: AgentRunLifecycle,
    pub process_status: Option<ExecutionProcessStatus>,
    pub exit_code: Option<i64>,
    pub runtime_error: Option<AgentRuntimeError>,
}

pub(crate) fn classify_starting() -> AgentRuntimeSupervisorOutcome {
    in_flight(AgentRunLifecycle::Starting)
}

pub(crate) fn classify_running() -> AgentRuntimeSupervisorOutcome {
    in_flight(AgentRunLifecycle::Running)
}

pub(crate) fn classify_cancellation_requested() -> AgentRuntimeSupervisorOutcome {
    in_flight(AgentRunLifecycle::Cancelling)
}

pub(crate) fn classify_executor_exit_result(
    result: ExecutorExitResult,
) -> AgentRuntimeSupervisorOutcome {
    match result {
        ExecutorExitResult::Success => terminal(
            AgentRunLifecycle::Completed,
            ExecutionProcessStatus::Completed,
            Some(EXECUTOR_SIGNAL_SUCCESS_EXIT_CODE),
            None,
        ),
        ExecutorExitResult::Failure => {
            let exit_code = Some(EXECUTOR_SIGNAL_FAILURE_EXIT_CODE);
            terminal(
                AgentRunLifecycle::Failed,
                ExecutionProcessStatus::Failed,
                exit_code,
                Some(runtime_error(
                    AgentRuntimeErrorKind::Unknown,
                    "executor reported failure",
                    exit_code,
                )),
            )
        }
    }
}

pub(crate) fn classify_process_exit(exit_status: ExitStatus) -> AgentRuntimeSupervisorOutcome {
    let exit_code = Some(i64::from(exit_status.code().unwrap_or(-1)));

    if exit_status.success() {
        terminal(
            AgentRunLifecycle::Completed,
            ExecutionProcessStatus::Completed,
            exit_code,
            None,
        )
    } else {
        terminal(
            AgentRunLifecycle::Failed,
            ExecutionProcessStatus::Failed,
            exit_code,
            Some(runtime_error(
                AgentRuntimeErrorKind::Unknown,
                "agent process exited unsuccessfully",
                exit_code,
            )),
        )
    }
}

pub(crate) fn classify_watcher_error(error: impl Into<String>) -> AgentRuntimeSupervisorOutcome {
    let message = error.into();
    terminal(
        AgentRunLifecycle::Crashed,
        ExecutionProcessStatus::Failed,
        None,
        Some(runtime_error(
            AgentRuntimeErrorKind::ProcessCrashed,
            format!("agent process watcher failed: {message}"),
            None,
        )),
    )
}

fn in_flight(lifecycle: AgentRunLifecycle) -> AgentRuntimeSupervisorOutcome {
    AgentRuntimeSupervisorOutcome {
        lifecycle,
        process_status: None,
        exit_code: None,
        runtime_error: None,
    }
}

fn terminal(
    lifecycle: AgentRunLifecycle,
    process_status: ExecutionProcessStatus,
    exit_code: Option<i64>,
    runtime_error: Option<AgentRuntimeError>,
) -> AgentRuntimeSupervisorOutcome {
    AgentRuntimeSupervisorOutcome {
        lifecycle,
        process_status: Some(process_status),
        exit_code,
        runtime_error,
    }
}

fn runtime_error(
    kind: AgentRuntimeErrorKind,
    message: impl Into<String>,
    exit_code: Option<i64>,
) -> AgentRuntimeError {
    let exit_code = exit_code.and_then(|code| i32::try_from(code).ok());
    AgentRuntimeError::new(kind, message).with_exit_code(exit_code)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn success_status() -> ExitStatus {
        exit_status(0)
    }

    fn failure_status() -> ExitStatus {
        exit_status(2)
    }

    fn exit_status(code: i32) -> ExitStatus {
        #[cfg(unix)]
        {
            use std::os::unix::process::ExitStatusExt;

            ExitStatusExt::from_raw(code << 8)
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::ExitStatusExt;

            ExitStatusExt::from_raw(code as u32)
        }
    }

    #[test]
    fn classifies_executor_success_as_completed() {
        let outcome = classify_executor_exit_result(ExecutorExitResult::Success);

        assert_eq!(outcome.lifecycle, AgentRunLifecycle::Completed);
        assert_eq!(
            outcome.process_status,
            Some(ExecutionProcessStatus::Completed)
        );
        assert_eq!(outcome.exit_code, Some(0));
        assert_eq!(outcome.runtime_error, None);
    }

    #[test]
    fn classifies_executor_failure_as_failed() {
        let outcome = classify_executor_exit_result(ExecutorExitResult::Failure);

        assert_eq!(outcome.lifecycle, AgentRunLifecycle::Failed);
        assert_eq!(outcome.process_status, Some(ExecutionProcessStatus::Failed));
        assert_eq!(outcome.exit_code, Some(1));
        assert_eq!(
            outcome.runtime_error.as_ref().map(|error| error.kind),
            Some(AgentRuntimeErrorKind::Unknown)
        );
    }

    #[test]
    fn classifies_os_success_as_completed() {
        let outcome = classify_process_exit(success_status());

        assert_eq!(outcome.lifecycle, AgentRunLifecycle::Completed);
        assert_eq!(
            outcome.process_status,
            Some(ExecutionProcessStatus::Completed)
        );
        assert_eq!(outcome.exit_code, Some(0));
        assert_eq!(outcome.runtime_error, None);
    }

    #[test]
    fn classifies_os_non_zero_as_failed() {
        let outcome = classify_process_exit(failure_status());

        assert_eq!(outcome.lifecycle, AgentRunLifecycle::Failed);
        assert_eq!(outcome.process_status, Some(ExecutionProcessStatus::Failed));
        assert_eq!(outcome.exit_code, Some(2));
        assert_eq!(
            outcome.runtime_error.as_ref().map(|error| error.kind),
            Some(AgentRuntimeErrorKind::Unknown)
        );
    }

    #[test]
    fn classifies_watcher_error_as_crashed() {
        let outcome = classify_watcher_error("child handle missing");

        assert_eq!(outcome.lifecycle, AgentRunLifecycle::Crashed);
        assert_eq!(outcome.process_status, Some(ExecutionProcessStatus::Failed));
        assert_eq!(outcome.exit_code, None);
        assert_eq!(
            outcome.runtime_error.as_ref().map(|error| error.kind),
            Some(AgentRuntimeErrorKind::ProcessCrashed)
        );
    }

    #[test]
    fn classifies_cancellation_request_as_in_flight_cancelling() {
        let outcome = classify_cancellation_requested();

        assert_eq!(outcome.lifecycle, AgentRunLifecycle::Cancelling);
        assert_eq!(outcome.process_status, None);
        assert_eq!(outcome.exit_code, None);
        assert_eq!(outcome.runtime_error, None);
    }
}
