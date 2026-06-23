use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum AgentRuntimeLaunchPhase {
    CommandBuild,
    ProcessSpawn,
    ProtocolConnect,
    Warmup,
    SessionResume,
    Accepted,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_launch_phase_as_snake_case() {
        let encoded = serde_json::to_string(&AgentRuntimeLaunchPhase::ProtocolConnect)
            .expect("launch phase should serialize");

        assert_eq!(encoded, r#""protocol_connect""#);
    }
}
