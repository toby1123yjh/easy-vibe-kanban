//! OpenCode owns its CLI launch shape; ACP owns session/model options.
use super::Opencode;
use crate::{
    command::{CommandBuildError, CommandBuilder, OPENCODE_DEFAULT_BASE_COMMAND},
    executors::{acp::provider, provider_adapter::DirectControl},
};

pub struct OpencodeCommandAdapter<'a> {
    agent: &'a Opencode,
}
impl<'a> OpencodeCommandAdapter<'a> {
    pub fn new(agent: &'a Opencode) -> Self {
        Self { agent }
    }
    pub fn build(&self) -> Result<CommandBuilder, CommandBuildError> {
        provider::build_command(OPENCODE_DEFAULT_BASE_COMMAND, &["acp"], &self.agent.cmd)
    }
}
pub(crate) fn encode_control(control: DirectControl) -> Result<Vec<u8>, serde_json::Error> {
    provider::encode_control(control)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_acp_command_preserves_overrides_without_download_or_cli_model_flags() {
        let agent: Opencode = serde_json::from_value(serde_json::json!({"model":"provider/model", "reasoning_effort":"high", "additional_params":["--native-option"]})).unwrap();
        let command = OpencodeCommandAdapter::new(&agent).build().unwrap();
        assert_eq!(command.base, "opencode");
        assert_eq!(command.params.unwrap(), vec!["acp", "--native-option"]);
    }
}
