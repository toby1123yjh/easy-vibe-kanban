use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum AgentRunLifecycle {
    Starting,
    Running,
    WaitingApproval,
    WaitingInput,
    Cancelling,
    Completed,
    Failed,
    Crashed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_lifecycle_as_snake_case() {
        let encoded = serde_json::to_string(&AgentRunLifecycle::WaitingApproval)
            .expect("lifecycle should serialize");

        assert_eq!(encoded, r#""waiting_approval""#);
    }
}
