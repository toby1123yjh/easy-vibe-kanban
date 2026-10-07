//! DeepSeek Harness owns its developer-preview ACP profile launch shape.
use super::DeepseekHarness;
use crate::{
    command::{CommandBuildError, CommandBuilder, DEEPSEEK_HARNESS_DEFAULT_BASE_COMMAND},
    executors::{acp::provider, provider_adapter::DirectControl},
};

pub struct DeepseekHarnessCommandAdapter<'a> {
    agent: &'a DeepseekHarness,
}
impl<'a> DeepseekHarnessCommandAdapter<'a> {
    pub fn new(agent: &'a DeepseekHarness) -> Self {
        Self { agent }
    }
    pub fn build(&self) -> Result<CommandBuilder, CommandBuildError> {
        provider::build_command(
            DEEPSEEK_HARNESS_DEFAULT_BASE_COMMAND,
            &["--profile", "acp"],
            &self.agent.cmd,
        )
    }
}
pub(crate) fn encode_control(control: DirectControl) -> Result<Vec<u8>, serde_json::Error> {
    provider::encode_control(control)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dsh_uses_local_acp_profile_and_keeps_opaque_model_off_cli() {
        let agent: DeepseekHarness = serde_json::from_value(serde_json::json!({"model":"[\"provider\",\"model\"]", "additional_params":["--native-option"]})).unwrap();
        let command = DeepseekHarnessCommandAdapter::new(&agent).build().unwrap();
        assert_eq!(command.base, "dsh");
        assert_eq!(
            command.params.unwrap(),
            vec!["--profile", "acp", "--native-option"]
        );
    }
}
