pub mod client;
pub mod jsonrpc;
pub mod normalize_logs;
pub mod review;
pub mod slash_commands;
use std::{
    borrow::Cow,
    collections::HashMap,
    env,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

/// Returns the Codex home directory.
///
/// Checks the `CODEX_HOME` environment variable first, then falls back to `~/.codex`.
/// This allows users to configure a custom location for Codex configuration and state.
pub fn codex_home() -> Option<PathBuf> {
    if let Ok(codex_home) = env::var("CODEX_HOME")
        && !codex_home.trim().is_empty()
    {
        return Some(PathBuf::from(codex_home));
    }
    dirs::home_dir().map(|home| home.join(".codex"))
}

pub(crate) fn resolve_model(model: Option<&str>) -> (Option<&str>, bool) {
    match model.and_then(|m| m.strip_suffix("-fast")) {
        Some(base) => (Some(base), true),
        None => (model, false),
    }
}

pub(crate) fn fork_params_from(thread_id: String, params: ThreadStartParams) -> ThreadForkParams {
    ThreadForkParams {
        thread_id,
        model: params.model,
        model_provider: params.model_provider,
        cwd: params.cwd,
        approval_policy: params.approval_policy,
        sandbox: params.sandbox,
        config: params.config,
        base_instructions: params.base_instructions,
        developer_instructions: params.developer_instructions,
        service_tier: params.service_tier,
        ..Default::default()
    }
}

const SKILLS_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(10);
const MODELS_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(10);

use async_trait::async_trait;
use codex_app_server_protocol::{
    AskForApproval as V2AskForApproval, ModelListResponse, ReviewTarget,
    SandboxMode as V2SandboxMode, SkillScope, SkillsListResponse, ThreadForkParams,
    ThreadStartParams, UserInput,
};
use codex_protocol::{
    config_types::ServiceTier, openai_models::ReasoningEffort as ProtocolReasoningEffort,
};
use derivative::Derivative;
use futures::StreamExt;
use schemars::{JsonSchema, Schema, SchemaGenerator};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use strum_macros::AsRefStr;
use tokio::process::Command;
use ts_rs::TS;
use workspace_utils::{command_ext::GroupSpawnNoWindowExt, msg_store::MsgStore};

use self::{
    client::{AppServerClient, LogWriter},
    jsonrpc::{ExitSignalSender, JsonRpcPeer},
    normalize_logs::{Error, normalize_logs},
};
use crate::{
    actions::SelectedSkill,
    approvals::ExecutorApprovalService,
    command::{CmdOverrides, CommandBuildError, CommandBuilder, CommandParts, apply_overrides},
    env::{ExecutionEnv, RepoContext},
    executor_discovery::{CodexSkillDescription, CodexSkillLoadError, ExecutorDiscoveredOptions},
    executors::{
        AppendPrompt, AvailabilityInfo, BaseCodingAgent, ExecutorError, ExecutorExitResult,
        SpawnedChild, StandardCodingAgentExecutor,
    },
    logs::utils::patch,
    model_selector::{ModelInfo, ModelSelectorConfig, PermissionPolicy, ReasoningOption},
    profile::ExecutorConfig,
    stdout_dup::create_stdout_pipe_writer,
};

/// Sandbox policy modes for Codex
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema, AsRefStr)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum SandboxMode {
    Auto,
    ReadOnly,
    WorkspaceWrite,
    DangerFullAccess,
}

/// Determines when the user is consulted to approve Codex actions.
///
/// - `UnlessTrusted`: Read-only commands are auto-approved. Everything else will
///   ask the user to approve.
/// - `OnRequest`: The model decides when to ask the user for approval.
/// - `Never`: Commands never ask for approval. Commands that fail in the
///   restricted sandbox are not retried.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema, AsRefStr)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum AskForApproval {
    UnlessTrusted,
    OnRequest,
    Never,
}

/// Reasoning effort for the underlying model.
#[derive(Debug, Clone, PartialEq, Eq, TS)]
#[ts(type = "string")]
pub struct ReasoningEffort(String);

impl ReasoningEffort {
    pub fn as_str(&self) -> &str {
        &self.0
    }

    fn to_protocol(&self) -> ProtocolReasoningEffort {
        self.as_str()
            .parse()
            .expect("local Codex reasoning effort is always non-empty")
    }
}

impl std::fmt::Display for ReasoningEffort {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for ReasoningEffort {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        if value.is_empty() {
            Err("reasoning effort must not be empty".to_string())
        } else {
            Ok(Self(value.to_string()))
        }
    }
}

impl Serialize for ReasoningEffort {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for ReasoningEffort {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        value.parse().map_err(serde::de::Error::custom)
    }
}

impl JsonSchema for ReasoningEffort {
    fn inline_schema() -> bool {
        true
    }

    fn schema_name() -> Cow<'static, str> {
        Cow::Borrowed("ReasoningEffort")
    }

    fn json_schema(_generator: &mut SchemaGenerator) -> Schema {
        schemars::json_schema!({
            "type": "string",
            "description": "A non-empty reasoning effort value advertised by Codex model discovery or supplied by the user.",
            "minLength": 1,
        })
    }
}

/// Model reasoning summary style
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema, AsRefStr)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ReasoningSummary {
    Auto,
    Concise,
    Detailed,
    None,
}

/// Format for model reasoning summaries
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS, JsonSchema, AsRefStr)]
#[serde(rename_all = "kebab-case")]
#[strum(serialize_all = "kebab-case")]
pub enum ReasoningSummaryFormat {
    None,
    Experimental,
}

enum CodexSessionAction {
    Chat {
        prompt: String,
        selected_skills: Vec<SelectedSkill>,
    },
    Review {
        target: ReviewTarget,
    },
}

#[derive(Derivative, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[derivative(Debug, PartialEq)]
pub struct Codex {
    #[serde(default)]
    pub append_prompt: AppendPrompt,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sandbox: Option<SandboxMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ask_for_approval: Option<AskForApproval>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oss: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reasoning_effort: Option<ReasoningEffort>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reasoning_summary: Option<ReasoningSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_reasoning_summary_format: Option<ReasoningSummaryFormat>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_instructions: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_apply_patch_tool: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compact_prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub developer_instructions: Option<String>,
    #[serde(default)]
    pub plan: bool,
    #[serde(flatten)]
    pub cmd: CmdOverrides,

    #[serde(skip)]
    #[ts(skip)]
    #[derivative(Debug = "ignore", PartialEq = "ignore")]
    approvals: Option<Arc<dyn ExecutorApprovalService>>,
}

#[async_trait]
impl StandardCodingAgentExecutor for Codex {
    fn apply_overrides(&mut self, executor_config: &ExecutorConfig) {
        if let Some(model_id) = &executor_config.model_id {
            self.model = Some(model_id.clone());
        }
        if let Some(reasoning_id) = &executor_config.reasoning_id
            && let Ok(reasoning_effort) = reasoning_id.parse()
        {
            self.model_reasoning_effort = Some(reasoning_effort)
        }
        if let Some(permission_policy) = &executor_config.permission_policy {
            match permission_policy {
                crate::model_selector::PermissionPolicy::Auto => {
                    self.ask_for_approval = Some(AskForApproval::Never);
                    self.plan = false;
                }
                crate::model_selector::PermissionPolicy::Supervised => {
                    if matches!(self.ask_for_approval, None | Some(AskForApproval::Never)) {
                        self.ask_for_approval = Some(AskForApproval::UnlessTrusted);
                    }
                    self.plan = false;
                }
                crate::model_selector::PermissionPolicy::Plan => {
                    self.plan = true;
                }
            }
        }
    }

    fn use_approvals(&mut self, approvals: Arc<dyn ExecutorApprovalService>) {
        self.approvals = Some(approvals);
    }

    async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.spawn_slash_command(current_dir, prompt, None, vec![], env)
            .await
    }

    async fn spawn_with_selected_skills(
        &self,
        current_dir: &Path,
        prompt: &str,
        selected_skills: &[SelectedSkill],
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.spawn_slash_command(current_dir, prompt, None, selected_skills.to_vec(), env)
            .await
    }

    async fn spawn_follow_up(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: &str,
        _reset_to_message_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.spawn_slash_command(current_dir, prompt, Some(session_id), vec![], env)
            .await
    }

    async fn spawn_follow_up_with_selected_skills(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: &str,
        _reset_to_message_id: Option<&str>,
        selected_skills: &[SelectedSkill],
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        self.spawn_slash_command(
            current_dir,
            prompt,
            Some(session_id),
            selected_skills.to_vec(),
            env,
        )
        .await
    }

    fn normalize_logs(
        &self,
        msg_store: Arc<MsgStore>,
        worktree_path: &Path,
    ) -> Vec<tokio::task::JoinHandle<()>> {
        normalize_logs(msg_store, worktree_path)
    }

    fn default_mcp_config_path(&self) -> Option<PathBuf> {
        codex_home().map(|home| home.join("config.toml"))
    }

    fn get_availability_info(&self) -> AvailabilityInfo {
        if let Some(timestamp) = codex_home()
            .and_then(|home| std::fs::metadata(home.join("auth.json")).ok())
            .and_then(|m| m.modified().ok())
            .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
        {
            return AvailabilityInfo::LoginDetected {
                last_auth_timestamp: timestamp,
            };
        }

        let mcp_config_found = self
            .default_mcp_config_path()
            .map(|p| p.exists())
            .unwrap_or(false);

        let installation_indicator_found = codex_home()
            .map(|home| home.join("version.json").exists())
            .unwrap_or(false);

        if mcp_config_found || installation_indicator_found {
            AvailabilityInfo::InstallationFound
        } else {
            AvailabilityInfo::NotFound
        }
    }

    fn get_preset_options(&self) -> ExecutorConfig {
        use crate::model_selector::*;
        let permission_policy = if self.plan {
            PermissionPolicy::Plan
        } else if matches!(self.ask_for_approval, None | Some(AskForApproval::Never)) {
            PermissionPolicy::Auto
        } else {
            PermissionPolicy::Supervised
        };

        ExecutorConfig {
            executor: BaseCodingAgent::Codex,
            variant: None,
            model_id: self.model.clone(),
            agent_id: None,
            reasoning_id: self
                .model_reasoning_effort
                .as_ref()
                .map(|e| e.as_str().to_string()),
            permission_policy: Some(permission_policy),
        }
    }

    async fn discover_options(
        &self,
        workdir: Option<&std::path::Path>,
        repo_path: Option<&std::path::Path>,
    ) -> Result<futures::stream::BoxStream<'static, json_patch::Patch>, ExecutorError> {
        let skills_cwd = workdir.or(repo_path).map(Path::to_path_buf);
        let mut options = ExecutorDiscoveredOptions {
            model_selector: ModelSelectorConfig {
                models: fallback_models(),
                permissions: vec![
                    PermissionPolicy::Auto,
                    PermissionPolicy::Supervised,
                    PermissionPolicy::Plan,
                ],
                ..Default::default()
            },
            slash_commands: slash_commands::supported_slash_commands(),
            ..Default::default()
        };
        options.loading_models = true;
        options.loading_slash_commands = true;
        options.loading_skills = skills_cwd.is_some();
        let initial_patch = patch::executor_discovered_options(options);

        let this = self.clone();
        let models_cwd = skills_cwd.clone();
        let discovery_stream = async_stream::stream! {
            let slash_commands = slash_commands::supported_slash_commands();
            yield patch::update_slash_commands(slash_commands);
            yield patch::slash_commands_loaded();

            // Models: prefer the live `model/list` over the hardcoded fallback so
            // new Codex models appear automatically. Run against the resolved cwd
            // (config like model providers can be workspace-scoped).
            let model_dir = models_cwd
                .clone()
                .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
            let models_result = tokio::time::timeout(
                MODELS_DISCOVERY_TIMEOUT,
                this.discover_models(model_dir),
            )
            .await;
            match models_result {
                Ok(Ok(models)) if !models.is_empty() => {
                    yield patch::update_models(models);
                }
                Ok(Ok(_)) => {
                    tracing::warn!("Codex model/list returned no models; keeping fallback list");
                }
                Ok(Err(err)) => {
                    tracing::warn!("Failed to discover Codex models: {err}; keeping fallback list");
                }
                Err(_) => {
                    tracing::warn!("Timed out discovering Codex models; keeping fallback list");
                }
            }
            yield patch::models_loaded();

            let Some(skills_cwd) = skills_cwd else {
                return;
            };
            let result = tokio::time::timeout(
                SKILLS_DISCOVERY_TIMEOUT,
                this.discover_skills(skills_cwd),
            )
            .await;

            match result {
                Ok(Ok((skills, errors))) => {
                    let mut slash_commands = slash_commands::supported_slash_commands();
                    slash_commands.extend(slash_commands::skill_slash_commands(&skills));
                    yield patch::update_slash_commands(slash_commands);
                    yield patch::update_skills(skills);
                    yield patch::update_skill_errors(errors);
                }
                Ok(Err(err)) => {
                    tracing::warn!("Failed to discover Codex skills: {err}");
                    yield patch::update_skill_errors(vec![CodexSkillLoadError {
                        path: PathBuf::new(),
                        message: format!("Failed to discover Codex skills: {err}"),
                    }]);
                }
                Err(_) => {
                    yield patch::update_skill_errors(vec![CodexSkillLoadError {
                        path: PathBuf::new(),
                        message: "Timed out discovering Codex skills".to_string(),
                    }]);
                }
            }
            yield patch::skills_loaded();
        };

        Ok(Box::pin(
            futures::stream::once(async move { initial_patch }).chain(discovery_stream),
        ))
    }

    async fn spawn_review(
        &self,
        current_dir: &Path,
        prompt: &str,
        session_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let review_target = ReviewTarget::Custom {
            instructions: prompt.to_string(),
        };
        self.spawn_review_target(current_dir, review_target, session_id, env)
            .await
    }
}

impl Codex {
    async fn spawn_review_target(
        &self,
        current_dir: &Path,
        review_target: ReviewTarget,
        session_id: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let command_parts = self.build_command_builder()?.build_initial()?;
        let action = CodexSessionAction::Review {
            target: review_target,
        };
        self.spawn_inner(current_dir, command_parts, action, session_id, env)
            .await
    }
}

impl Codex {
    pub const DEFAULT_BASE_COMMAND: &'static str = "codex";

    /// Prefers the Codex pinned by the npx wrapper so the binary version
    /// matches the `codex-app-server-protocol` crate this build links against.
    pub fn base_command() -> String {
        super::bundled::bundled_codex_command()
            .unwrap_or_else(|| Self::DEFAULT_BASE_COMMAND.to_string())
    }

    fn launch_context(&self, program_path: &Path, args: &[String], current_dir: &Path) -> String {
        let codex_config = codex_home()
            .map(|home| home.join("config.toml").display().to_string())
            .unwrap_or_else(|| "<unresolved>".to_string());

        let mut lines = vec![
            format!(
                "base command: {}",
                self.cmd
                    .base_command_override
                    .clone()
                    .unwrap_or_else(Self::base_command)
            ),
            format!(
                "base_command_override: {}",
                if self.cmd.base_command_override.is_some() {
                    "set"
                } else {
                    "not set"
                }
            ),
            format!("resolved executable: {}", program_path.display()),
            format!("args: {args:?}"),
            format!("cwd: {}", current_dir.display()),
            format!("codex config: {codex_config}"),
        ];

        if let Some(model) = &self.model {
            lines.push(format!("model: {model}"));
        }
        if let Some(model_provider) = &self.model_provider {
            lines.push(format!("model_provider: {model_provider}"));
        }
        if let Some(profile) = &self.profile {
            lines.push(format!("profile: {profile}"));
        }
        if let Some(additional_params) = &self.cmd.additional_params {
            lines.push(format!("additional_params: {additional_params:?}"));
        }

        lines.join("\n")
    }

    fn build_command_builder(&self) -> Result<CommandBuilder, CommandBuildError> {
        let mut builder = CommandBuilder::new(Self::base_command());
        builder = builder.extend_params(["app-server"]);
        if self.oss.unwrap_or(false) {
            builder = builder.extend_params(["--oss"]);
        }

        apply_overrides(builder, &self.cmd)
    }

    async fn discover_skills(
        &self,
        cwd: PathBuf,
    ) -> Result<(Vec<CodexSkillDescription>, Vec<CodexSkillLoadError>), ExecutorError> {
        let request_cwd = cwd.clone();
        let response = self
            .with_discovery_app_server(&cwd, move |client| async move {
                client.skills_list(request_cwd).await
            })
            .await?;
        Ok(skills_list_response_to_discovery(response))
    }

    async fn discover_models(&self, cwd: PathBuf) -> Result<Vec<ModelInfo>, ExecutorError> {
        let response = self
            .with_discovery_app_server(&cwd, move |client| async move { client.model_list().await })
            .await?;
        Ok(model_list_response_to_model_infos(response))
    }

    async fn with_discovery_app_server<T, F, Fut>(
        &self,
        current_dir: &Path,
        task: F,
    ) -> Result<T, ExecutorError>
    where
        F: FnOnce(Arc<AppServerClient>) -> Fut,
        Fut: std::future::Future<Output = Result<T, ExecutorError>>,
    {
        let command_parts = self.build_command_builder()?.build_initial()?;
        let (program_path, args) = command_parts.into_resolved().await?;
        let launch_context = self.launch_context(&program_path, &args, current_dir);

        let mut process = Command::new(&program_path);
        process
            .kill_on_drop(true)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .current_dir(current_dir)
            .env("NPM_CONFIG_LOGLEVEL", "error")
            .env("NODE_NO_WARNINGS", "1")
            .env("NO_COLOR", "1")
            .env("RUST_LOG", "error")
            .args(&args);

        ExecutionEnv::new(RepoContext::default(), false, String::new())
            .with_profile(&self.cmd)
            .apply_to_command(&mut process);

        let mut child = process.group_spawn_no_window().map_err(|err| {
            ExecutorError::Io(std::io::Error::other(format!(
                "failed to spawn Codex app-server for discovery: {err}\n\nCodex launch context:\n{}",
                launch_context
            )))
        })?;

        let child_stdout = child.inner().stdout.take().ok_or_else(|| {
            ExecutorError::Io(std::io::Error::other("Codex app server missing stdout"))
        })?;
        let child_stdin = child.inner().stdin.take().ok_or_else(|| {
            ExecutorError::Io(std::io::Error::other("Codex app server missing stdin"))
        })?;

        let cancel = tokio_util::sync::CancellationToken::new();
        let (exit_signal_tx, _exit_signal_rx) = tokio::sync::oneshot::channel();
        let exit_signal_tx = ExitSignalSender::new(exit_signal_tx);
        let client = AppServerClient::new(
            LogWriter::new(tokio::io::sink()),
            None,
            false,
            self.plan,
            None,
            RepoContext::default(),
            false,
            String::new(),
            cancel.clone(),
        );
        let rpc_peer = JsonRpcPeer::spawn(
            child_stdin,
            child_stdout,
            client.clone(),
            exit_signal_tx,
            cancel.clone(),
        );
        client.connect(rpc_peer);

        let result = async {
            client.initialize().await?;
            task(client).await
        }
        .await;

        cancel.cancel();
        let _ = child.kill().await;

        result
    }

    fn build_thread_start_params(&self, cwd: &Path) -> ThreadStartParams {
        let sandbox = match self.sandbox.as_ref() {
            None | Some(SandboxMode::Auto) => Some(V2SandboxMode::WorkspaceWrite), // match the Auto preset in codex
            Some(SandboxMode::ReadOnly) => Some(V2SandboxMode::ReadOnly),
            Some(SandboxMode::WorkspaceWrite) => Some(V2SandboxMode::WorkspaceWrite),
            Some(SandboxMode::DangerFullAccess) => Some(V2SandboxMode::DangerFullAccess),
        };

        let approval_policy = match self.ask_for_approval.as_ref() {
            None if matches!(self.sandbox.as_ref(), None | Some(SandboxMode::Auto)) => {
                // match the Auto preset in codex
                Some(V2AskForApproval::OnRequest)
            }
            None => None,
            Some(AskForApproval::UnlessTrusted) => Some(V2AskForApproval::UnlessTrusted),
            Some(AskForApproval::OnRequest) => Some(V2AskForApproval::OnRequest),
            Some(AskForApproval::Never) => Some(V2AskForApproval::Never),
        };

        let mut config = self.build_config_overrides();
        // V1 top-level params that moved into config overrides in v2
        if let Some(profile) = &self.profile {
            config
                .get_or_insert_with(HashMap::new)
                .insert("profile".to_string(), Value::String(profile.clone()));
        }
        if let Some(include) = self.include_apply_patch_tool {
            config
                .get_or_insert_with(HashMap::new)
                .insert("include_apply_patch_tool".to_string(), Value::Bool(include));
        }
        if let Some(compact) = &self.compact_prompt {
            config
                .get_or_insert_with(HashMap::new)
                .insert("compact_prompt".to_string(), Value::String(compact.clone()));
        }
        let (model, is_fast) = resolve_model(self.model.as_deref());
        let service_tier = if is_fast {
            Some(Some(ServiceTier::Fast.request_value().to_string()))
        } else {
            None
        };

        ThreadStartParams {
            model: model.map(|m| m.to_string()),
            cwd: Some(cwd.to_string_lossy().to_string()),
            approval_policy,
            sandbox,
            config,
            base_instructions: self.base_instructions.clone(),
            model_provider: self.model_provider.clone(),
            developer_instructions: self.developer_instructions.clone(),
            service_tier,
            ..Default::default()
        }
    }

    fn build_config_overrides(&self) -> Option<HashMap<String, Value>> {
        let mut overrides = HashMap::new();

        if let Some(effort) = &self.model_reasoning_effort {
            overrides.insert(
                "model_reasoning_effort".to_string(),
                Value::String(effort.as_str().to_string()),
            );
        }

        if let Some(summary) = &self.model_reasoning_summary {
            overrides.insert(
                "model_reasoning_summary".to_string(),
                Value::String(summary.as_ref().to_string()),
            );
        }

        if let Some(format) = &self.model_reasoning_summary_format
            && format != &ReasoningSummaryFormat::None
        {
            overrides.insert(
                "model_reasoning_summary_format".to_string(),
                Value::String(format.as_ref().to_string()),
            );
        }

        if overrides.is_empty() {
            None
        } else {
            Some(overrides)
        }
    }

    async fn spawn_inner(
        &self,
        current_dir: &Path,
        command_parts: CommandParts,
        action: CodexSessionAction,
        resume_session: Option<&str>,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let params = self.build_thread_start_params(current_dir);
        let resume_session = resume_session.map(|s| s.to_string());

        self.spawn_app_server(
            current_dir,
            command_parts,
            env,
            move |client, _| async move {
                match action {
                    CodexSessionAction::Chat {
                        prompt,
                        selected_skills,
                    } => {
                        Self::launch_codex_agent(
                            params,
                            resume_session,
                            prompt,
                            selected_skills,
                            client,
                        )
                        .await
                    }
                    CodexSessionAction::Review { target } => {
                        review::launch_codex_review(params, resume_session, target, client).await
                    }
                }
            },
        )
        .await
    }

    async fn launch_codex_agent(
        thread_start_params: ThreadStartParams,
        resume_session: Option<String>,
        combined_prompt: String,
        selected_skills: Vec<SelectedSkill>,
        client: Arc<AppServerClient>,
    ) -> Result<(), ExecutorError> {
        let account = client.get_account().await?;
        if account.requires_openai_auth && account.account.is_none() {
            return Err(ExecutorError::AuthRequired(
                "Codex authentication required".to_string(),
            ));
        }

        let (thread_id, resolved_model) = match resume_session {
            None => {
                let response = client.thread_start(thread_start_params).await?;
                (response.thread.id, response.model)
            }
            Some(session_id) => {
                let response = client
                    .thread_fork(fork_params_from(session_id, thread_start_params))
                    .await?;
                tracing::debug!("forked thread, new thread_id={}", response.thread.id);
                (response.thread.id, response.model)
            }
        };

        client.set_resolved_model(resolved_model);
        client.register_session(&thread_id).await?;
        let collaboration_mode = client.initial_collaboration_mode()?;
        let input = build_chat_input(combined_prompt, selected_skills);
        client
            .turn_start_with_mode(thread_id, input, Some(collaboration_mode))
            .await?;

        Ok(())
    }

    /// Common boilerplate for spawning a Codex app server process
    /// Handles process spawning, stdout/stderr piping, exit signal handling, client initialization, and error logging.
    /// Delegates the actual Codex session logic to the provided `task` closure.
    async fn spawn_app_server<F, Fut>(
        &self,
        current_dir: &Path,
        command_parts: CommandParts,
        env: &ExecutionEnv,
        task: F,
    ) -> Result<SpawnedChild, ExecutorError>
    where
        F: FnOnce(Arc<AppServerClient>, ExitSignalSender) -> Fut + Send + 'static,
        Fut: std::future::Future<Output = Result<(), ExecutorError>> + Send + 'static,
    {
        let (program_path, args) = command_parts.into_resolved().await?;
        let launch_context = self.launch_context(&program_path, &args, current_dir);
        tracing::debug!("Launching Codex app-server:\n{}", launch_context);

        let mut process = Command::new(&program_path);
        process
            .kill_on_drop(true)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .current_dir(current_dir)
            .env("NPM_CONFIG_LOGLEVEL", "error")
            .env("NODE_NO_WARNINGS", "1")
            .env("NO_COLOR", "1")
            .env("RUST_LOG", "error")
            .args(&args);

        env.clone()
            .with_profile(&self.cmd)
            .apply_to_command(&mut process);

        let spawn_error_context = launch_context.clone();
        let mut child = process.group_spawn_no_window().map_err(|err| {
            ExecutorError::Io(std::io::Error::other(format!(
                "failed to spawn Codex app-server: {err}\n\nCodex launch context:\n{}",
                spawn_error_context
            )))
        })?;

        let child_stdout = child.inner().stdout.take().ok_or_else(|| {
            ExecutorError::Io(std::io::Error::other("Codex app server missing stdout"))
        })?;
        let child_stdin = child.inner().stdin.take().ok_or_else(|| {
            ExecutorError::Io(std::io::Error::other("Codex app server missing stdin"))
        })?;

        let new_stdout = create_stdout_pipe_writer(&mut child)?;
        let (exit_signal_tx, exit_signal_rx) = tokio::sync::oneshot::channel();
        let cancel = tokio_util::sync::CancellationToken::new();

        let auto_approve = matches!(
            (&self.sandbox, &self.ask_for_approval),
            (Some(SandboxMode::DangerFullAccess), None)
        );
        let plan_mode = self.plan;
        let reasoning_effort = self
            .model_reasoning_effort
            .as_ref()
            .map(ReasoningEffort::to_protocol);
        let approvals = self.approvals.clone();
        let repo_context = env.repo_context.clone();
        let commit_reminder = env.commit_reminder;
        let commit_reminder_prompt = env.commit_reminder_prompt.clone();
        let cancel_for_task = cancel.clone();

        tokio::spawn(async move {
            let exit_signal_tx = ExitSignalSender::new(exit_signal_tx);
            let log_writer = LogWriter::new(new_stdout);

            // Initialize the AppServerClient
            let client = AppServerClient::new(
                log_writer.clone(),
                approvals,
                auto_approve,
                plan_mode,
                reasoning_effort,
                repo_context,
                commit_reminder,
                commit_reminder_prompt,
                cancel_for_task.clone(),
            );
            let rpc_peer = JsonRpcPeer::spawn(
                child_stdin,
                child_stdout,
                client.clone(),
                exit_signal_tx.clone(),
                cancel_for_task,
            );
            client.connect(rpc_peer);

            let result = async {
                client.initialize().await?;
                task(client, exit_signal_tx.clone()).await
            }
            .await;

            if let Err(err) = result {
                match &err {
                    ExecutorError::Io(io_err)
                        if io_err.kind() == std::io::ErrorKind::BrokenPipe =>
                    {
                        // Broken pipe likely means the parent process exited, so we can ignore it
                        return;
                    }
                    ExecutorError::AuthRequired(message) => {
                        log_writer
                            .log_raw(&Error::auth_required(message.clone()).raw())
                            .await
                            .ok();
                        exit_signal_tx
                            .send_exit_signal(ExecutorExitResult::Failure)
                            .await;
                        return;
                    }
                    _ => {
                        tracing::error!("Codex spawn error: {}", err);
                        let error = format!("{}\n\nCodex launch context:\n{}", err, launch_context);
                        log_writer
                            .log_raw(&Error::launch_error(error).raw())
                            .await
                            .ok();
                    }
                }
                exit_signal_tx
                    .send_exit_signal(ExecutorExitResult::Failure)
                    .await;
            }
        });

        Ok(SpawnedChild {
            child,
            exit_signal: Some(exit_signal_rx),
            cancel: Some(cancel),
        })
    }
}

fn build_chat_input(
    combined_prompt: String,
    selected_skills: Vec<SelectedSkill>,
) -> Vec<UserInput> {
    let mut input = selected_skills
        .into_iter()
        .map(|skill| UserInput::Skill {
            name: skill.name,
            path: skill.path,
        })
        .collect::<Vec<_>>();
    input.push(UserInput::Text {
        text: combined_prompt,
        text_elements: vec![],
    });
    input
}

fn skills_list_response_to_discovery(
    response: SkillsListResponse,
) -> (Vec<CodexSkillDescription>, Vec<CodexSkillLoadError>) {
    let mut skills = Vec::new();
    let mut errors = Vec::new();

    for entry in response.data {
        for skill in entry.skills {
            skills.push(CodexSkillDescription {
                name: skill.name,
                description: skill.description,
                short_description: skill
                    .interface
                    .and_then(|interface| interface.short_description)
                    .or(skill.short_description),
                path: skill.path.to_path_buf(),
                scope: skill_scope_to_string(skill.scope).to_string(),
                enabled: skill.enabled,
            });
        }

        for error in entry.errors {
            errors.push(CodexSkillLoadError {
                path: error.path,
                message: error.message,
            });
        }
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.path.cmp(&b.path)));
    errors.sort_by(|a, b| a.path.cmp(&b.path));
    (skills, errors)
}

fn skill_scope_to_string(scope: SkillScope) -> &'static str {
    match scope {
        SkillScope::User => "user",
        SkillScope::Repo => "repo",
        SkillScope::System => "system",
        SkillScope::Admin => "admin",
    }
}

/// Convert a live `model/list` response into the UI model-selector shape,
/// dropping models hidden from the default picker.
fn model_list_response_to_model_infos(response: ModelListResponse) -> Vec<ModelInfo> {
    response
        .data
        .into_iter()
        .filter(|model| !model.hidden)
        .map(|model| {
            let default_reasoning_effort = model.default_reasoning_effort.to_string();
            let reasoning_options = ReasoningOption::from_names_with_default(
                model
                    .supported_reasoning_efforts
                    .iter()
                    .map(|option| option.reasoning_effort.to_string()),
                Some(&default_reasoning_effort),
            );
            ModelInfo {
                id: model.id,
                name: model.display_name,
                provider_id: None,
                reasoning_options,
            }
        })
        .collect()
}

/// Static model list used before/instead of a live `model/list` response
/// (discovery failure, timeout, or empty result).
fn fallback_models() -> Vec<ModelInfo> {
    let xhigh_reasoning_options =
        ReasoningOption::from_names(["none", "minimal", "low", "medium", "high", "xhigh"]);
    let max_reasoning_options =
        ReasoningOption::from_names(["low", "medium", "high", "xhigh", "max"]);
    let ultra_reasoning_options =
        ReasoningOption::from_names(["low", "medium", "high", "xhigh", "max", "ultra"]);

    let mut models = [
        ("gpt-5.5", "GPT-5.5"),
        ("gpt-5.5-fast", "GPT-5.5 Fast"),
        ("gpt-5.4", "GPT-5.4"),
        ("gpt-5.4-fast", "GPT-5.4 Fast"),
        ("gpt-5.4-mini", "GPT-5.4 Mini"),
        ("gpt-5.3-codex", "GPT-5.3 Codex"),
        ("gpt-5.3-codex-spark", "GPT-5.3 Codex Spark"),
        ("gpt-5.2", "GPT-5.2"),
    ]
    .into_iter()
    .map(|(id, name)| ModelInfo {
        id: id.to_string(),
        name: name.to_string(),
        provider_id: None,
        reasoning_options: xhigh_reasoning_options.clone(),
    })
    .collect::<Vec<_>>();
    models.splice(
        0..0,
        [
            ModelInfo {
                id: "gpt-5.6-sol".to_string(),
                name: "GPT-5.6-Sol".to_string(),
                provider_id: None,
                reasoning_options: ultra_reasoning_options.clone(),
            },
            ModelInfo {
                id: "gpt-5.6-terra".to_string(),
                name: "GPT-5.6-Terra".to_string(),
                provider_id: None,
                reasoning_options: ultra_reasoning_options,
            },
            ModelInfo {
                id: "gpt-5.6-luna".to_string(),
                name: "GPT-5.6-Luna".to_string(),
                provider_id: None,
                reasoning_options: max_reasoning_options,
            },
        ],
    );
    models
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use codex_app_server_protocol::{Model, ModelListResponse, ReasoningEffortOption, UserInput};
    use codex_protocol::openai_models::ReasoningEffort as ProtocolReasoningEffort;
    use serde_json::json;

    use super::{
        AskForApproval, Codex, ReasoningEffort, build_chat_input, fallback_models,
        model_list_response_to_model_infos, resolve_model,
    };
    use crate::{
        actions::SelectedSkill,
        executors::{BaseCodingAgent, StandardCodingAgentExecutor},
        profile::ExecutorConfig,
    };

    fn test_executor() -> Codex {
        serde_json::from_value(json!({})).expect("empty Codex config should deserialize")
    }

    fn config_with_reasoning(reasoning_id: &str) -> ExecutorConfig {
        ExecutorConfig {
            executor: BaseCodingAgent::Codex,
            variant: None,
            model_id: None,
            agent_id: None,
            reasoning_id: Some(reasoning_id.to_string()),
            permission_policy: None,
        }
    }

    #[test]
    fn resolve_model_detects_fast_suffix() {
        assert_eq!(resolve_model(Some("gpt-5.5-fast")), (Some("gpt-5.5"), true));
        assert_eq!(resolve_model(Some("gpt-5.4-fast")), (Some("gpt-5.4"), true));
    }

    #[test]
    fn resolve_model_leaves_non_fast_models_unchanged() {
        assert_eq!(resolve_model(Some("gpt-5.5")), (Some("gpt-5.5"), false));
        assert_eq!(
            resolve_model(Some("gpt-5.4-mini")),
            (Some("gpt-5.4-mini"), false)
        );
        assert_eq!(resolve_model(None), (None, false));
    }

    #[test]
    fn apply_overrides_preserves_codex_protocol_reasoning_values() {
        let mut executor = test_executor();
        executor.apply_overrides(&config_with_reasoning("minimal"));

        let overrides = executor
            .build_config_overrides()
            .expect("reasoning override should produce config");
        assert_eq!(
            overrides.get("model_reasoning_effort"),
            Some(&json!("minimal"))
        );
    }

    #[test]
    fn missing_reasoning_override_omits_model_reasoning_effort() {
        let executor = test_executor();

        let overrides = executor.build_config_overrides();

        assert_eq!(overrides, None);
    }

    #[test]
    fn apply_overrides_preserves_custom_reasoning_values() {
        let mut executor = test_executor();
        executor.apply_overrides(&config_with_reasoning("max"));

        let overrides = executor
            .build_config_overrides()
            .expect("reasoning override should produce config");
        assert_eq!(overrides.get("model_reasoning_effort"), Some(&json!("max")));
    }

    #[test]
    fn reasoning_effort_maps_to_codex_protocol_values() {
        let xhigh = "xhigh"
            .parse::<ReasoningEffort>()
            .expect("xhigh is a valid reasoning effort");
        assert_eq!(xhigh.to_protocol(), ProtocolReasoningEffort::XHigh);

        let max = "max"
            .parse::<ReasoningEffort>()
            .expect("max is a valid reasoning effort");
        assert_eq!(max.to_protocol(), ProtocolReasoningEffort::Max);

        let ultra = "ultra"
            .parse::<ReasoningEffort>()
            .expect("ultra is a valid reasoning effort");
        assert_eq!(ultra.to_protocol(), ProtocolReasoningEffort::Ultra);

        let custom = "max-plus"
            .parse::<ReasoningEffort>()
            .expect("custom non-empty efforts are valid");
        assert_eq!(
            custom.to_protocol(),
            ProtocolReasoningEffort::Custom("max-plus".to_string())
        );
    }

    #[test]
    fn removed_on_failure_approval_policy_is_rejected() {
        assert!(serde_json::from_str::<AskForApproval>(r#""on-failure""#).is_err());
    }

    #[test]
    fn new_threads_use_supported_default_history_without_model_fallback() {
        let params = test_executor().build_thread_start_params(Path::new("/tmp/test-worktree"));

        assert!(params.history_mode.is_none());
        assert!(!params.allow_provider_model_fallback);
    }

    #[test]
    fn model_list_uses_codex_default_reasoning_effort() {
        let response = ModelListResponse {
            data: vec![Model {
                id: "gpt-test".to_string(),
                model: "gpt-test".to_string(),
                upgrade: None,
                upgrade_info: None,
                availability_nux: None,
                display_name: "GPT Test".to_string(),
                description: "test model".to_string(),
                hidden: false,
                supported_reasoning_efforts: vec![
                    ReasoningEffortOption {
                        reasoning_effort: ProtocolReasoningEffort::High,
                        description: "High".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: ProtocolReasoningEffort::Minimal,
                        description: "Minimal".to_string(),
                    },
                ],
                default_reasoning_effort: ProtocolReasoningEffort::Minimal,
                input_modalities: vec![],
                supports_personality: false,
                additional_speed_tiers: vec![],
                service_tiers: vec![],
                default_service_tier: None,
                is_default: false,
            }],
            next_cursor: None,
        };

        let models = model_list_response_to_model_infos(response);

        assert_eq!(models.len(), 1);
        let reasoning_options = &models[0].reasoning_options;
        assert_eq!(
            reasoning_options
                .iter()
                .find(|option| option.is_default)
                .map(|option| option.id.as_str()),
            Some("minimal")
        );
    }

    #[test]
    fn model_list_preserves_gpt_5_6_max_and_ultra_reasoning_efforts() {
        let response = ModelListResponse {
            data: vec![Model {
                id: "gpt-5.6-sol".to_string(),
                model: "gpt-5.6-sol".to_string(),
                upgrade: None,
                upgrade_info: None,
                availability_nux: None,
                display_name: "GPT-5.6-Sol".to_string(),
                description: "Latest frontier agentic coding model.".to_string(),
                hidden: false,
                supported_reasoning_efforts: vec![
                    ReasoningEffortOption {
                        reasoning_effort: ProtocolReasoningEffort::Max,
                        description: "Maximum reasoning depth".to_string(),
                    },
                    ReasoningEffortOption {
                        reasoning_effort: ProtocolReasoningEffort::Ultra,
                        description: "Maximum reasoning with delegation".to_string(),
                    },
                ],
                default_reasoning_effort: ProtocolReasoningEffort::Max,
                input_modalities: vec![],
                supports_personality: false,
                additional_speed_tiers: vec![],
                service_tiers: vec![],
                default_service_tier: None,
                is_default: true,
            }],
            next_cursor: None,
        };

        let models = model_list_response_to_model_infos(response);
        let ids = models[0]
            .reasoning_options
            .iter()
            .map(|option| option.id.as_str())
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["max", "ultra"]);
        assert!(models[0].reasoning_options[0].is_default);
    }

    #[test]
    fn fallback_models_include_gpt_5_6_catalog() {
        let models = fallback_models();

        assert_eq!(
            models
                .iter()
                .take(3)
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec!["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]
        );
        let sol = &models[0];
        assert!(
            sol.reasoning_options
                .iter()
                .any(|option| option.id == "max")
        );
        assert!(
            sol.reasoning_options
                .iter()
                .any(|option| option.id == "ultra")
        );
    }

    #[test]
    fn build_chat_input_places_selected_skills_before_text() {
        let skill_path = PathBuf::from("/tmp/skills/review/SKILL.md");
        let input = build_chat_input(
            "review this change".to_string(),
            vec![SelectedSkill {
                name: "code-review".to_string(),
                path: skill_path.clone(),
            }],
        );

        assert_eq!(input.len(), 2);
        match &input[0] {
            UserInput::Skill { name, path } => {
                assert_eq!(name, "code-review");
                assert_eq!(path, &skill_path);
            }
            other => panic!("expected skill input first, got {other:?}"),
        }
        match &input[1] {
            UserInput::Text {
                text,
                text_elements,
            } => {
                assert_eq!(text, "review this change");
                assert!(text_elements.is_empty());
            }
            other => panic!("expected text input second, got {other:?}"),
        }
    }
}
