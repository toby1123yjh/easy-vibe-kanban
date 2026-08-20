//! Oh My Pi-native command construction.

use serde_json::Value;
use uuid::Uuid;

use super::OhMyPi;
use crate::{
    command::{CommandBuildError, CommandBuilder, apply_overrides},
    executors::provider_adapter::{DirectControl, DirectIntent, encode_stdio_rpc},
};

pub struct OhMyPiCommandAdapter<'a> {
    agent: &'a OhMyPi,
}

impl<'a> OhMyPiCommandAdapter<'a> {
    pub fn new(agent: &'a OhMyPi) -> Self {
        Self { agent }
    }

    pub fn build(
        &self,
        intent: DirectIntent,
        session_id: Option<&str>,
    ) -> Result<CommandBuilder, CommandBuildError> {
        let mut builder = CommandBuilder::new(OhMyPi::DEFAULT_BASE_COMMAND)
            .extend_params(["--mode", OhMyPi::RUNTIME_MODE]);
        if matches!(
            intent,
            DirectIntent::FollowUp | DirectIntent::Resume | DirectIntent::Review
        ) && let Some(session_id) = session_id
        {
            builder = builder.extend_params(["--resume", session_id]);
        }
        if let Some(model) = self.agent.model.as_deref() {
            builder = builder.extend_params(["--model", model]);
        }
        apply_overrides(builder, &self.agent.cmd)
    }
}

pub(crate) fn encode_control(control: DirectControl) -> Result<Vec<u8>, serde_json::Error> {
    let request = match control {
        DirectControl::Cancel => serde_json::json!({"type":"abort"}),
        DirectControl::Approve { .. } | DirectControl::Input { .. } => {
            return Err(serde_json::Error::io(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "Oh My Pi RPC does not expose host approval/input responses",
            )));
        }
        DirectControl::Steer { text } => serde_json::json!({"type":"steer","message":text}),
    };
    encode_stdio_rpc(&request)
}

pub(crate) fn session_request(prompt: &str, session_id: Option<&str>) -> Value {
    let _ = session_id;
    serde_json::json!({"id": Uuid::new_v4().to_string(), "type":"prompt", "message":prompt})
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;
    use crate::executors::provider_adapter::{DirectControl, DirectIntent};

    #[test]
    fn owns_omp_rpc_launch_shape() {
        let agent = OhMyPi::default();
        let builder = OhMyPiCommandAdapter::new(&agent)
            .build(DirectIntent::Resume, Some("session-1"))
            .unwrap();

        assert_eq!(builder.base, "omp");
        assert_eq!(
            builder.params.unwrap(),
            vec![
                "--mode".to_string(),
                "rpc".to_string(),
                "--resume".to_string(),
                "session-1".to_string()
            ]
        );
    }

    #[test]
    fn owns_omp_session_and_control_encoding() {
        let resume = session_request("continue", Some("session-1"));
        let cancel: Value =
            serde_json::from_slice(&encode_control(DirectControl::Cancel).unwrap()).unwrap();

        assert_eq!(resume["type"], "prompt");
        assert_eq!(resume["message"], "continue");
        assert_eq!(cancel["type"], "abort");
    }

    #[test]
    fn applies_omp_command_overrides_after_native_args() {
        let agent: OhMyPi = serde_json::from_value(serde_json::json!({
            "additional_params": ["--profile-flag"]
        }))
        .unwrap();
        let params = OhMyPiCommandAdapter::new(&agent)
            .build(DirectIntent::Initial, None)
            .unwrap()
            .params
            .unwrap();

        assert_eq!(params.last().map(String::as_str), Some("--profile-flag"));
    }
}
