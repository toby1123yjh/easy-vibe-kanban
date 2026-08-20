//! Codex-native command construction for the app-server transport.

use uuid::Uuid;

use super::Codex;
use crate::{
    command::{CommandBuildError, CommandBuilder, apply_overrides},
    executors::provider_adapter::{DirectControl, encode_stdio_rpc},
};

pub struct CodexCommandAdapter<'a> {
    agent: &'a Codex,
}

impl<'a> CodexCommandAdapter<'a> {
    pub fn new(agent: &'a Codex) -> Self {
        Self { agent }
    }

    pub fn build(&self) -> Result<CommandBuilder, CommandBuildError> {
        let mut builder = CommandBuilder::new(Codex::base_command())
            .extend_params(["app-server"])
            .extend_params(Codex::DISABLE_NATIVE_MEMORY_ARGS);
        if self.agent.oss.unwrap_or(false) {
            builder = builder.extend_params(["--oss"]);
        }

        // Profile parameters are applied last so an advanced user can
        // explicitly opt back into native memory for this executor profile.
        apply_overrides(builder, &self.agent.cmd)
    }
}

pub(crate) fn encode_control(control: DirectControl) -> Result<Vec<u8>, serde_json::Error> {
    let request = match control {
        DirectControl::Cancel => serde_json::json!({
            "jsonrpc":"2.0", "id": Uuid::new_v4().to_string(),
            "method":"turn/interrupt",
            "params":{"threadId":"<active-thread>","turnId":"<active-turn>"}
        }),
        DirectControl::Steer { text } => serde_json::json!({
            "jsonrpc":"2.0", "id": Uuid::new_v4().to_string(),
            "method":"turn/steer",
            "params":{"threadId":"<active-thread>","expectedTurnId":"<active-turn>","input":[{"type":"text","text":text}]}
        }),
        DirectControl::Approve { .. } | DirectControl::Input { .. } => {
            return Err(serde_json::Error::io(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "Codex approval/input responses require the original server request id",
            )));
        }
    };
    encode_stdio_rpc(&request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::executors::provider_adapter::DirectControl;

    #[test]
    fn owns_codex_app_server_launch_shape() {
        let agent: Codex = serde_json::from_value(serde_json::json!({"oss": true})).unwrap();
        let builder = CodexCommandAdapter::new(&agent).build().unwrap();
        let params = builder.params.unwrap();

        assert_eq!(builder.base, "codex");
        assert_eq!(params.first().map(String::as_str), Some("app-server"));
        assert_eq!(params.last().map(String::as_str), Some("--oss"));
    }

    #[test]
    fn owns_codex_control_encoding() {
        let value: serde_json::Value =
            serde_json::from_slice(&encode_control(DirectControl::Cancel).unwrap()).unwrap();

        assert_eq!(value["method"], "turn/interrupt");
        assert!(value["id"].is_string());
        assert!(value["params"]["threadId"].is_string());
    }

    #[test]
    fn applies_codex_command_overrides_after_native_args() {
        let agent: Codex = serde_json::from_value(serde_json::json!({
            "additional_params": ["--profile-flag"]
        }))
        .unwrap();
        let params = CodexCommandAdapter::new(&agent)
            .build()
            .unwrap()
            .params
            .unwrap();

        assert_eq!(params.last().map(String::as_str), Some("--profile-flag"));
    }
}
