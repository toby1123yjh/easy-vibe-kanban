//! Gemini-native command construction.
//!
//! Gemini owns its ACP startup flags and profile-specific options here. The
//! runtime only selects the provider and passes the resulting command to the
//! ACP transport.

use uuid::Uuid;

use super::Gemini;
use crate::{
    command::{CommandBuildError, CommandBuilder, apply_overrides},
    executors::provider_adapter::{DirectControl, encode_stdio_rpc},
};

pub struct GeminiCommandAdapter<'a> {
    agent: &'a Gemini,
}

impl<'a> GeminiCommandAdapter<'a> {
    pub fn new(agent: &'a Gemini) -> Self {
        Self { agent }
    }

    pub fn build(&self) -> Result<CommandBuilder, CommandBuildError> {
        let mut builder = CommandBuilder::new("gemini");

        if let Some(model) = &self.agent.model {
            builder = builder.extend_params(["--model", model.as_str()]);
        }

        if self.agent.yolo.unwrap_or(false) {
            builder = builder
                .extend_params(["--yolo"])
                .extend_params(["--allowed-tools", "run_shell_command"]);
        }

        apply_overrides(
            builder.extend_params(["--experimental-acp"]),
            &self.agent.cmd,
        )
    }
}

pub(crate) fn encode_control(control: DirectControl) -> Result<Vec<u8>, serde_json::Error> {
    let request = match control {
        DirectControl::Cancel => serde_json::json!({
            "jsonrpc":"2.0",
            "method":"session/cancel",
            "params":{"sessionId":"<active-session>"}
        }),
        DirectControl::Steer { text } => serde_json::json!({
            "jsonrpc":"2.0",
            "id":Uuid::new_v4().to_string(),
            "method":"session/prompt",
            "params":{"sessionId":"<active-session>","prompt":[{"type":"text","text":text}]}
        }),
        DirectControl::Approve { .. } | DirectControl::Input { .. } => {
            return Err(serde_json::Error::io(std::io::Error::new(
                std::io::ErrorKind::Unsupported,
                "ACP permission/input responses require the active connection request id",
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
    fn owns_gemini_acp_launch_shape() {
        let agent: Gemini = serde_json::from_value(serde_json::json!({
            "model": "gemini-test",
            "yolo": true
        }))
        .unwrap();
        let builder = GeminiCommandAdapter::new(&agent).build().unwrap();

        assert_eq!(builder.base, "gemini");
        assert_eq!(
            builder.params.unwrap(),
            vec![
                "--model".to_string(),
                "gemini-test".to_string(),
                "--yolo".to_string(),
                "--allowed-tools".to_string(),
                "run_shell_command".to_string(),
                "--experimental-acp".to_string(),
            ]
        );
    }

    #[test]
    fn owns_gemini_control_encoding() {
        let value: serde_json::Value = serde_json::from_slice(
            &encode_control(DirectControl::Steer {
                text: "continue".to_string(),
            })
            .unwrap(),
        )
        .unwrap();

        assert_eq!(value["method"], "session/prompt");
        assert_eq!(value["params"]["prompt"][0]["text"], "continue");
    }

    #[test]
    fn applies_gemini_command_overrides_after_native_args() {
        let agent: Gemini = serde_json::from_value(serde_json::json!({
            "additional_params": ["--profile-flag"]
        }))
        .unwrap();
        let params = GeminiCommandAdapter::new(&agent)
            .build()
            .unwrap()
            .params
            .unwrap();

        assert_eq!(params.last().map(String::as_str), Some("--profile-flag"));
    }
}
