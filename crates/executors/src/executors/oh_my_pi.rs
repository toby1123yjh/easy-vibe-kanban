//! Oh My Pi (`can1357/oh-my-pi`) direct runtime adapter.
//!
//! V1 intentionally launches the real `omp` executable and speaks its stdio
//! RPC NDJSON protocol.  No Node SDK or in-process package is linked here.

use std::{path::Path, process::Stdio};

use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tokio::{io::AsyncWriteExt, process::Command};
use tokio_util::sync::CancellationToken;
use ts_rs::TS;
use workspace_utils::command_ext::GroupSpawnNoWindowExt;

use crate::{
    command::{CmdOverrides, CommandBuildError, CommandBuilder},
    env::ExecutionEnv,
    executors::{
        AppendPrompt, AvailabilityInfo, BaseCodingAgent, ExecutorError, SpawnedChild,
        StandardCodingAgentExecutor,
        provider_adapter::{DirectIntent, DirectProvider, encode_stdio_rpc, oh_my_pi_rpc_request},
    },
    profile::ExecutorConfig,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema, Default)]
pub struct OhMyPi {
    #[serde(default)]
    pub append_prompt: AppendPrompt,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(flatten)]
    pub cmd: CmdOverrides,
}

impl OhMyPi {
    pub const DEFAULT_BASE_COMMAND: &'static str = "omp";
    pub const RUNTIME_MODE: &'static str = "rpc";

    pub fn build_command_builder(
        &self,
        intent: DirectIntent,
    ) -> Result<CommandBuilder, CommandBuildError> {
        DirectProvider::OhMyPi.command(intent, None, &self.cmd)
    }

    pub fn provider(&self) -> DirectProvider {
        DirectProvider::OhMyPi
    }

    pub fn capabilities(
        &self,
        runtime_profile_id: impl Into<String>,
    ) -> crate::runtime::CapabilitySnapshot {
        self.provider().capabilities(runtime_profile_id)
    }

    pub fn direct_mapper(&self) -> crate::executors::provider_adapter::DirectProviderMapper {
        self.provider().mapper()
    }

    pub(crate) fn apply_direct_overrides(&mut self, executor_config: &ExecutorConfig) {
        if let Some(model_id) = &executor_config.model_id {
            self.model = Some(model_id.clone());
        }
    }

    pub(crate) async fn launch_direct(
        &self,
        intent: DirectIntent,
        current_dir: &Path,
        prompt: &str,
        session_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        match intent {
            DirectIntent::Initial => self.spawn(current_dir, prompt, env).await,
            DirectIntent::FollowUp | DirectIntent::Resume => {
                let session_id = session_id.ok_or_else(|| {
                    ExecutorError::FollowUpNotSupported(
                        "Oh My Pi direct follow-up requires a provider session".to_string(),
                    )
                })?;
                self.spawn_follow_up(current_dir, prompt, session_id, env)
                    .await
            }
            DirectIntent::Review => {
                self.spawn_review(current_dir, prompt, session_id, env)
                    .await
            }
        }
    }

    /// Launch `omp --mode rpc`, write one initialize/start request, and return
    /// the live process to the supervisor.  The process remains responsible
    /// for all tool execution and MCP ownership.
    pub async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.spawn_rpc(current_dir, prompt, None, env).await
    }

    pub async fn spawn_follow_up(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.spawn_rpc(current_dir, prompt, Some(session_id), env)
            .await
    }

    pub async fn spawn_review(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.spawn_rpc(current_dir, prompt, session_id, env).await
    }

    async fn spawn_rpc(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let mut builder = DirectProvider::OhMyPi.command(
            if session_id.is_some() {
                DirectIntent::FollowUp
            } else {
                DirectIntent::Initial
            },
            session_id,
            &self.cmd,
        )?;
        if let Some(model) = self.model.as_deref() {
            builder = builder.extend_params(["--model", model]);
        }
        let (program, args) = builder.build_initial()?.into_resolved().await?;
        let mut command = Command::new(program);
        command
            .kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .current_dir(current_dir)
            .args(args);
        env.clone()
            .with_profile(&self.cmd)
            .apply_to_command(&mut command);

        let mut child = command.group_spawn_no_window()?;
        let request = oh_my_pi_rpc_request(
            if session_id.is_some() {
                "session/resume"
            } else {
                "session/start"
            },
            1,
            Some(&self.append_prompt.combine_prompt(prompt)),
            session_id,
        );
        if let Some(stdin) = child.inner().stdin.as_mut() {
            stdin.write_all(&encode_stdio_rpc(&request)?).await?;
            stdin.flush().await?;
        }

        // The supervisor owns cancellation and process-tree cleanup.  Keeping
        // a token on the returned child makes the control boundary explicit.
        Ok(SpawnedChild {
            child,
            exit_signal: None,
            cancel: Some(CancellationToken::new()),
        })
    }

    pub fn default_mcp_config_path(&self) -> Option<std::path::PathBuf> {
        dirs::home_dir().map(|home| home.join(".omp").join("settings.json"))
    }

    pub fn get_availability_info(&self) -> AvailabilityInfo {
        if self
            .default_mcp_config_path()
            .is_some_and(|path| path.exists())
        {
            AvailabilityInfo::InstallationFound
        } else {
            AvailabilityInfo::NotFound
        }
    }

    pub fn get_preset_options(&self) -> ExecutorConfig {
        ExecutorConfig {
            executor: BaseCodingAgent::OhMyPi,
            variant: None,
            model_id: self.model.clone(),
            agent_id: None,
            reasoning_id: None,
            permission_policy: Some(crate::model_selector::PermissionPolicy::Supervised),
        }
    }
}

#[async_trait]
impl StandardCodingAgentExecutor for OhMyPi {
    fn apply_overrides(&mut self, executor_config: &ExecutorConfig) {
        self.apply_direct_overrides(executor_config);
    }

    async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        OhMyPi::spawn(self, current_dir, prompt, env).await
    }

    async fn spawn_follow_up(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: &str,
        reset_to_message_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        if reset_to_message_id.is_some() {
            return Err(ExecutorError::ResetToMessageNotSupported(
                "Oh My Pi stdio RPC does not expose message-level reset".to_string(),
            ));
        }
        OhMyPi::spawn_follow_up(self, current_dir, prompt, session_id, env).await
    }

    async fn spawn_review(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        OhMyPi::spawn_review(self, current_dir, prompt, session_id, env).await
    }

    fn default_mcp_config_path(&self) -> Option<std::path::PathBuf> {
        OhMyPi::default_mcp_config_path(self)
    }

    fn get_availability_info(&self) -> AvailabilityInfo {
        OhMyPi::get_availability_info(self)
    }

    fn get_preset_options(&self) -> ExecutorConfig {
        ExecutorConfig {
            executor: BaseCodingAgent::OhMyPi,
            variant: None,
            model_id: self.model.clone(),
            agent_id: None,
            reasoning_id: None,
            permission_policy: Some(crate::model_selector::PermissionPolicy::Supervised),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registered_preset_uses_oh_my_pi_identity() {
        let preset = OhMyPi::default().get_preset_options();

        assert_eq!(preset.executor, BaseCodingAgent::OhMyPi);
        assert_eq!(preset.variant, None);
    }

    #[test]
    fn rpc_command_uses_the_real_omp_executable() {
        let command = OhMyPi::default()
            .build_command_builder(DirectIntent::Initial)
            .expect("Oh My Pi command should build");

        assert_eq!(command.base, "omp");
        assert_eq!(command.params, Some(vec!["--mode".into(), "rpc".into()]));
    }

    #[tokio::test]
    async fn reset_request_is_rejected_instead_of_silently_downgrading() {
        let env = ExecutionEnv::new(Default::default(), false, String::new());
        let result = <OhMyPi as StandardCodingAgentExecutor>::spawn_follow_up(
            &OhMyPi::default(),
            Path::new("."),
            "prompt",
            "session",
            Some("message"),
            &env,
        )
        .await;

        assert!(matches!(
            result,
            Err(ExecutorError::ResetToMessageNotSupported(_))
        ));
    }
}
