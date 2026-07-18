use std::{path::Path, sync::Arc, time::Duration};

use async_trait::async_trait;
use derivative::Derivative;
use futures::StreamExt;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use workspace_utils::msg_store::MsgStore;

pub use super::acp::AcpAgentHarness;
use super::acp::discovery::{AcpModelCatalog, discover_model_catalog};
use crate::{
    approvals::ExecutorApprovalService,
    command::{CmdOverrides, CommandBuildError, CommandBuilder, apply_overrides},
    env::ExecutionEnv,
    executor_discovery::{ExecutorConfigCacheKey, ExecutorDiscoveredOptions},
    executors::{
        AppendPrompt, AvailabilityInfo, BaseCodingAgent, ExecutorError, SpawnedChild,
        StandardCodingAgentExecutor, utils::executor_options_cache,
    },
    logs::utils::patch,
    model_selector::{ModelInfo, ModelSelectorConfig, PermissionPolicy},
    profile::ExecutorConfig,
};

const MODEL_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Derivative, Clone, Serialize, Deserialize, TS, JsonSchema)]
#[derivative(Debug, PartialEq)]
pub struct Copilot {
    #[serde(default)]
    pub append_prompt: AppendPrompt,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_all_tools: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow_tool: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deny_tool: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub add_dir: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disable_mcp_server: Option<Vec<String>>,
    #[serde(flatten)]
    pub cmd: CmdOverrides,
    #[serde(skip)]
    #[ts(skip)]
    #[derivative(Debug = "ignore", PartialEq = "ignore")]
    pub approvals: Option<Arc<dyn ExecutorApprovalService>>,
}

impl Copilot {
    fn build_command_builder(&self) -> Result<CommandBuilder, CommandBuildError> {
        let mut builder = CommandBuilder::new("copilot");

        if self.allow_all_tools.unwrap_or(false) {
            builder = builder.extend_params(["--allow-all-tools"]);
        }

        if let Some(model) = &self.model {
            builder = builder.extend_params(["--model", model]);
        }

        if let Some(tool) = &self.allow_tool {
            builder = builder.extend_params(["--allow-tool", tool]);
        }

        if let Some(tool) = &self.deny_tool {
            builder = builder.extend_params(["--deny-tool", tool]);
        }

        if let Some(dirs) = &self.add_dir {
            for dir in dirs {
                builder = builder.extend_params(["--add-dir", dir]);
            }
        }

        if let Some(servers) = &self.disable_mcp_server {
            for server in servers {
                builder = builder.extend_params(["--disable-mcp-server", server]);
            }
        }

        builder = builder.extend_params(["--acp"]);

        apply_overrides(builder, &self.cmd)
    }

    fn build_discovery_command_builder(&self) -> Result<CommandBuilder, CommandBuildError> {
        apply_overrides(
            CommandBuilder::new("copilot").extend_params(["--acp"]),
            &self.cmd,
        )
    }

    fn compute_models_cache_key(&self) -> String {
        serde_json::to_string(&self.cmd).unwrap_or_default()
    }
}

fn copilot_permissions() -> Vec<PermissionPolicy> {
    vec![PermissionPolicy::Auto, PermissionPolicy::Supervised]
}

fn fallback_models() -> Vec<ModelInfo> {
    [
        ("gpt-5.4", "GPT-5.4"),
        ("claude-opus-4.6", "Claude Opus 4.6"),
        ("claude-opus-4.6-fast", "Claude Opus 4.6 Fast"),
        ("gpt-5.3-codex", "GPT-5.3 Codex"),
        ("claude-sonnet-4.6", "Claude Sonnet 4.6"),
        ("claude-haiku-4.5", "Claude Haiku 4.5"),
        ("gemini-3-pro-preview", "Gemini 3 Pro Preview"),
        ("gpt-5.2-codex", "GPT-5.2 Codex"),
        ("gpt-5.2", "GPT-5.2"),
        ("gpt-5.1-codex-max", "GPT-5.1 Codex Max"),
        ("gpt-5.1-codex", "GPT-5.1 Codex"),
        ("gpt-5.1", "GPT-5.1"),
        ("gpt-5.1-codex-mini", "GPT-5.1 Codex Mini"),
        ("gpt-5-mini", "GPT-5 Mini"),
        ("gpt-4.1", "GPT-4.1"),
        ("claude-opus-4.5", "Claude Opus 4.5"),
        ("claude-sonnet-4.5", "Claude Sonnet 4.5"),
        ("claude-sonnet-4", "Claude Sonnet 4"),
    ]
    .into_iter()
    .map(|(id, name)| ModelInfo {
        id: id.to_string(),
        name: name.to_string(),
        provider_id: None,
        reasoning_options: vec![],
    })
    .collect()
}

fn fallback_discovered_options() -> ExecutorDiscoveredOptions {
    ExecutorDiscoveredOptions {
        model_selector: ModelSelectorConfig {
            models: fallback_models(),
            permissions: copilot_permissions(),
            ..Default::default()
        },
        ..Default::default()
    }
}

fn selector_from_catalog(catalog: AcpModelCatalog) -> Option<ModelSelectorConfig> {
    if catalog.models.is_empty() {
        return None;
    }

    let default_model = catalog.current_model_id.filter(|current_model_id| {
        catalog
            .models
            .iter()
            .any(|model| model.id == *current_model_id)
    });
    let models = catalog
        .models
        .into_iter()
        .map(|model| ModelInfo {
            id: model.id,
            name: model.name,
            provider_id: None,
            reasoning_options: vec![],
        })
        .collect();

    Some(ModelSelectorConfig {
        models,
        default_model,
        permissions: copilot_permissions(),
        ..Default::default()
    })
}

#[async_trait]
impl StandardCodingAgentExecutor for Copilot {
    fn use_approvals(&mut self, approvals: Arc<dyn ExecutorApprovalService>) {
        self.approvals = Some(approvals);
    }

    fn apply_overrides(&mut self, executor_config: &ExecutorConfig) {
        if let Some(model_id) = &executor_config.model_id {
            self.model = Some(model_id.clone());
        }

        if let Some(permission_policy) = &executor_config.permission_policy {
            self.allow_all_tools = Some(matches!(
                permission_policy,
                crate::model_selector::PermissionPolicy::Auto
            ));
        }
    }

    async fn spawn(
        &self,
        current_dir: &Path,
        prompt: &str,
        env: &ExecutionEnv,
    ) -> Result<SpawnedChild, ExecutorError> {
        let harness = AcpAgentHarness::new();
        let combined_prompt = self.append_prompt.combine_prompt(prompt);
        let copilot_command = self.build_command_builder()?.build_initial()?;
        harness
            .spawn_with_command(
                current_dir,
                combined_prompt,
                copilot_command,
                env,
                &self.cmd,
                self.approvals.clone(),
            )
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
        let harness = AcpAgentHarness::new();
        let combined_prompt = self.append_prompt.combine_prompt(prompt);
        let copilot_command = self.build_command_builder()?.build_follow_up(&[])?;
        harness
            .spawn_follow_up_with_command(
                current_dir,
                combined_prompt,
                session_id,
                copilot_command,
                env,
                &self.cmd,
                self.approvals.clone(),
            )
            .await
    }

    fn normalize_logs(
        &self,
        msg_store: Arc<MsgStore>,
        worktree_path: &Path,
    ) -> Vec<tokio::task::JoinHandle<()>> {
        super::acp::normalize_logs(msg_store, worktree_path)
    }

    fn default_mcp_config_path(&self) -> Option<std::path::PathBuf> {
        dirs::home_dir().map(|home| home.join(".copilot").join("mcp-config.json"))
    }

    fn get_availability_info(&self) -> AvailabilityInfo {
        let mcp_config_found = self
            .default_mcp_config_path()
            .map(|p| p.exists())
            .unwrap_or(false);

        let installation_indicator_found = dirs::home_dir()
            .map(|home| home.join(".copilot").join("config.json").exists())
            .unwrap_or(false);

        if mcp_config_found || installation_indicator_found {
            AvailabilityInfo::InstallationFound
        } else {
            AvailabilityInfo::NotFound
        }
    }

    fn get_preset_options(&self) -> ExecutorConfig {
        ExecutorConfig {
            executor: BaseCodingAgent::Copilot,
            variant: None,
            model_id: self.model.clone(),
            agent_id: None,
            reasoning_id: None,
            permission_policy: Some(crate::model_selector::PermissionPolicy::Auto),
        }
    }

    async fn discover_options(
        &self,
        _workdir: Option<&std::path::Path>,
        _repo_path: Option<&std::path::Path>,
    ) -> Result<futures::stream::BoxStream<'static, json_patch::Patch>, ExecutorError> {
        let cache = executor_options_cache();
        let cache_key = ExecutorConfigCacheKey::new(
            None,
            self.compute_models_cache_key(),
            BaseCodingAgent::Copilot,
        );
        if let Some(cached) = cache.get(&cache_key) {
            let options = cached.as_ref().clone().with_loading(false);
            return Ok(Box::pin(futures::stream::once(async move {
                patch::executor_discovered_options(options)
            })));
        }

        let mut initial_options = fallback_discovered_options();
        initial_options.loading_models = true;
        let initial_patch = patch::executor_discovered_options(initial_options);
        let this = self.clone();

        let discovery_stream = async_stream::stream! {
            let command_parts = match this
                .build_discovery_command_builder()
                .and_then(|builder| builder.build_initial())
            {
                Ok(command_parts) => command_parts,
                Err(error) => {
                    tracing::warn!("Failed to build Copilot discovery command: {error}");
                    yield patch::models_loaded();
                    return;
                }
            };

            match discover_model_catalog(command_parts, &this.cmd, MODEL_DISCOVERY_TIMEOUT).await {
                Ok(catalog) => {
                    if let Some(selector) = selector_from_catalog(catalog) {
                        let final_options = ExecutorDiscoveredOptions {
                            model_selector: selector.clone(),
                            ..Default::default()
                        };
                        cache.put(cache_key, final_options);
                        yield patch::update_models(selector.models);
                        yield patch::update_default_model(selector.default_model);
                    } else {
                        tracing::warn!(
                            "Copilot ACP session/new returned no models; keeping fallback list"
                        );
                    }
                }
                Err(error) => {
                    tracing::warn!(
                        "Failed to discover Copilot models through ACP: {error}; keeping fallback list"
                    );
                }
            }

            yield patch::models_loaded();
        };

        Ok(Box::pin(
            futures::stream::once(async move { initial_patch }).chain(discovery_stream),
        ))
    }
}

#[cfg(test)]
mod tests {
    use futures::StreamExt;

    use super::*;
    use crate::executors::acp::discovery::{AcpDiscoveredModel, AcpModelCatalog};

    fn test_copilot() -> Copilot {
        serde_json::from_value(serde_json::json!({})).expect("default Copilot should deserialize")
    }

    #[test]
    fn discovery_command_uses_overrides_without_selected_runtime_model() {
        let mut copilot = test_copilot();
        copilot.model = Some("stale-model".to_string());
        copilot.cmd.base_command_override = Some("custom-copilot".to_string());
        copilot.cmd.additional_params = Some(vec!["--custom-flag".to_string()]);

        let builder = copilot
            .build_discovery_command_builder()
            .expect("discovery command should build");

        assert_eq!(builder.base, "custom-copilot");
        assert_eq!(
            builder.params,
            Some(vec!["--acp".to_string(), "--custom-flag".to_string()])
        );
        assert!(
            !builder
                .params
                .unwrap_or_default()
                .contains(&"stale-model".to_string())
        );
    }

    #[test]
    fn discovery_cache_key_includes_command_overrides() {
        let default = test_copilot();
        let mut overridden = test_copilot();
        overridden.cmd.base_command_override = Some("custom-copilot".to_string());

        assert_ne!(
            default.compute_models_cache_key(),
            overridden.compute_models_cache_key()
        );
    }

    #[test]
    fn dynamic_catalog_sets_default_and_preserves_ids() {
        let selector = selector_from_catalog(AcpModelCatalog {
            models: vec![
                AcpDiscoveredModel {
                    id: "provider:model/1.0".to_string(),
                    name: "Provider Model".to_string(),
                },
                AcpDiscoveredModel {
                    id: "claude-sonnet-4.6".to_string(),
                    name: "Claude Sonnet 4.6".to_string(),
                },
            ],
            current_model_id: Some("provider:model/1.0".to_string()),
        })
        .expect("non-empty catalog should produce a selector");

        assert_eq!(
            selector.default_model.as_deref(),
            Some("provider:model/1.0")
        );
        assert_eq!(selector.models[0].id, "provider:model/1.0");
        assert_eq!(selector.models[1].id, "claude-sonnet-4.6");
    }

    #[test]
    fn empty_dynamic_catalog_does_not_replace_fallback() {
        assert!(
            selector_from_catalog(AcpModelCatalog {
                models: vec![],
                current_model_id: Some("gpt-5".to_string()),
            })
            .is_none()
        );
        assert!(!fallback_models().is_empty());
    }

    #[tokio::test]
    async fn missing_discovery_binary_keeps_fallback_and_finishes_loading() {
        let mut copilot = test_copilot();
        copilot.cmd.base_command_override = Some(format!(
            "vibe-kanban-missing-copilot-{}",
            uuid::Uuid::new_v4()
        ));

        let patches = copilot
            .discover_options(None, None)
            .await
            .expect("fallback discovery stream should be created")
            .collect::<Vec<_>>()
            .await;

        assert_eq!(patches.len(), 2);
        let initial = serde_json::to_value(&patches[0]).expect("patch should serialize");
        assert_eq!(initial[0]["path"], "/options");
        assert_eq!(initial[0]["value"]["loading_models"], true);
        assert!(
            initial[0]["value"]["model_selector"]["models"]
                .as_array()
                .is_some_and(|models| !models.is_empty())
        );

        let finished = serde_json::to_value(&patches[1]).expect("patch should serialize");
        assert_eq!(finished[0]["path"], "/options/loading_models");
        assert_eq!(finished[0]["value"], false);
    }
}
