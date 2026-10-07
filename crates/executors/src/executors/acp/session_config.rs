//! Provider-owned ACP lifecycle and advertised configuration selection.
//!
//! Select values are opaque: never split model ids or trim reasoning values.
//! A model change replaces the entire option set before effort is validated.

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{LazyLock, Mutex},
};

use agent_client_protocol as proto;
use agent_client_protocol::Agent as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    executors::ExecutorError,
    model_selector::{
        AgentInfo, ModelInfo, ModelSelectorConfig, PermissionPolicy, ReasoningOption,
    },
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AcpDialect {
    Gemini,
    Opencode,
    DeepseekHarness,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NativeRestoreMethod {
    Resume,
    Load,
}

impl AcpDialect {
    pub fn restore_method(
        self,
        capabilities: &proto::AgentCapabilities,
    ) -> Result<NativeRestoreMethod, ExecutorError> {
        if self != Self::Gemini && capabilities.session_capabilities.resume.is_some() {
            return Ok(NativeRestoreMethod::Resume);
        }
        if self != Self::DeepseekHarness && capabilities.load_session {
            return Ok(NativeRestoreMethod::Load);
        }
        Err(config_error(
            "The agent does not advertise the required native session restoration method",
        ))
    }

    pub const fn effort_option(self) -> &'static str {
        match self {
            Self::Opencode => "effort",
            Self::DeepseekHarness => "reasoning_effort",
            Self::Gemini => "",
        }
    }
}

fn config_error(message: &str) -> ExecutorError {
    ExecutorError::Io(std::io::Error::new(
        std::io::ErrorKind::InvalidInput,
        message,
    ))
}

fn select<'a>(
    options: &'a [proto::SessionConfigOption],
    id: &str,
) -> Option<&'a proto::SessionConfigSelect> {
    options.iter().find_map(|option| {
        if option.id.0.as_ref() != id {
            return None;
        }
        match &option.kind {
            proto::SessionConfigKind::Select(select) => Some(select),
            _ => None,
        }
    })
}

fn values(select: &proto::SessionConfigSelect) -> Vec<&proto::SessionConfigSelectOption> {
    match &select.options {
        proto::SessionConfigSelectOptions::Ungrouped(options) => options.iter().collect(),
        proto::SessionConfigSelectOptions::Grouped(groups) => {
            groups.iter().flat_map(|group| &group.options).collect()
        }
        _ => Vec::new(),
    }
}

pub(crate) fn validate_selection(
    options: &[proto::SessionConfigOption],
    id: &str,
    value: &str,
) -> Result<(), ExecutorError> {
    let selector = select(options, id).ok_or_else(|| {
        config_error("The agent does not advertise the requested session configuration option")
    })?;
    if !values(selector)
        .iter()
        .any(|option| option.value.0.as_ref() == value)
    {
        // Requested values can be sensitive. Never include them, native
        // configuration or provider error.data in logs or errors.
        return Err(config_error(
            "The selected value is not advertised by this agent/model",
        ));
    }
    Ok(())
}

pub(crate) async fn apply_config_options(
    connection: &proto::ClientSideConnection,
    session_id: &str,
    dialect: AcpDialect,
    mut options: Vec<proto::SessionConfigOption>,
    model: Option<&str>,
    effort: Option<&str>,
    mode: Option<&str>,
) -> Result<Vec<proto::SessionConfigOption>, ExecutorError> {
    for (id, value) in [
        ("model", model),
        (dialect.effort_option(), effort),
        ("mode", mode),
    ] {
        let Some(value) = value else {
            continue;
        };
        validate_selection(&options, id, value)?;
        let response = connection
            .set_session_config_option(proto::SetSessionConfigOptionRequest::new(
                proto::SessionId::new(session_id.to_owned()),
                id.to_owned(),
                value.to_owned(),
            ))
            .await
            .map_err(|_| config_error("The agent rejected the selected session configuration"))?;
        options = response.config_options;
        let confirmed =
            select(&options, id).is_some_and(|select| select.current_value.0.as_ref() == value);
        if !confirmed {
            return Err(config_error(
                "The agent did not confirm the selected session configuration",
            ));
        }
    }
    Ok(options)
}

pub(crate) fn is_catalog_context_env(key: &str) -> bool {
    crate::workflow_mcp::is_context_env_key(key)
        || key.eq_ignore_ascii_case(crate::workflow_mcp::BACKEND_URL_ENV)
        || key.eq_ignore_ascii_case(crate::workflow_mcp::EXECUTABLE_ENV)
        || [
            "VK_WORKSPACE_ID",
            "VK_WORKSPACE_BRANCH",
            "VK_AGENT_RUN_ID",
            "VK_RUN_ATTEMPT_ID",
        ]
        .iter()
        .any(|context| key.eq_ignore_ascii_case(context))
}

/// Opaque native-authority scope shared by launch observations and discovery.
/// Platform run context and the currently selected model/effort are not routes.
pub fn catalog_identity(cmd: &crate::command::CmdOverrides) -> String {
    let env: std::collections::BTreeMap<_, _> = cmd
        .env
        .as_ref()
        .into_iter()
        .flat_map(|env| env.iter())
        .filter(|(key, _)| !is_catalog_context_env(key))
        .collect();
    let ambient: std::collections::BTreeMap<_, _> = std::env::vars()
        .filter(|(key, _)| {
            let key = key.to_ascii_uppercase();
            key.starts_with("OPENCODE_")
                || key.starts_with("DSH_")
                || key.starts_with("DEEPSEEK_")
                || key.starts_with("XDG_")
                || matches!(
                    key.as_str(),
                    "HOME" | "USERPROFILE" | "PATH" | "NODE_OPTIONS"
                )
        })
        .collect();
    let value = serde_json::json!({"base":cmd.base_command_override, "args":cmd.additional_params,
        "env":env, "ambient":ambient});
    format!("{:x}", Sha256::digest(value.to_string().as_bytes()))
}

pub const ACP_CATALOG_EVENT: &str = "acp_config_catalog";

/// A safe picker projection sent through the existing process-host observation
/// channel. No native config, credentials, transcript or workflow mounts.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcpCatalogObservation {
    pub working_dir: PathBuf,
    pub scope_id: String,
    pub model_selector: ModelSelectorConfig,
}

type ObservedCatalogs = HashMap<(AcpDialect, PathBuf, String), ModelSelectorConfig>;
static OBSERVED_CATALOGS: LazyLock<Mutex<ObservedCatalogs>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub(crate) fn observe_catalog(
    dialect: AcpDialect,
    cwd: PathBuf,
    identity: String,
    options: &[proto::SessionConfigOption],
) -> Option<AcpCatalogObservation> {
    if dialect == AcpDialect::Gemini {
        return None;
    }
    let model = select(options, "model")?;
    let effort = select(options, dialect.effort_option());
    let model_id = model.current_value.0.to_string();
    let mut seen = HashSet::new();
    let model_values: Vec<_> = values(model)
        .into_iter()
        .filter(|value| seen.insert(value.value.0.to_string()))
        .collect();
    let default_model = model_values
        .iter()
        .any(|value| value.value.0.as_ref() == model_id)
        .then(|| model_id.clone());
    let selector = ModelSelectorConfig {
        // Model ids (including DSH's JSON pair) remain opaque to the UI.
        providers: Vec::new(),
        models: model_values
            .into_iter()
            .map(|value| ModelInfo {
                id: value.value.0.to_string(),
                name: value.name.clone(),
                provider_id: None,
                // Effort belongs only to the model for which it was advertised.
                reasoning_options: if value.value.0.as_ref() == model_id {
                    effort
                        .map(|effort| {
                            values(effort)
                                .into_iter()
                                .map(|value| ReasoningOption {
                                    id: value.value.0.to_string(),
                                    label: value.name.clone(),
                                    is_default: value.value == effort.current_value,
                                })
                                .collect()
                        })
                        .unwrap_or_default()
                } else {
                    Vec::new()
                },
            })
            .collect(),
        default_model,
        agents: select(options, "mode")
            .map(|mode| {
                values(mode)
                    .into_iter()
                    .map(|value| AgentInfo {
                        id: value.value.0.to_string(),
                        label: value.name.clone(),
                        description: value.description.clone(),
                        is_default: value.value == mode.current_value,
                    })
                    .collect()
            })
            .unwrap_or_default(),
        permissions: vec![PermissionPolicy::Auto, PermissionPolicy::Supervised],
    };
    let observation = AcpCatalogObservation {
        working_dir: cwd,
        scope_id: identity,
        model_selector: selector,
    };
    cache_observation(dialect, &observation);
    Some(observation)
}

fn cache_observation(dialect: AcpDialect, observation: &AcpCatalogObservation) {
    if let Ok(mut catalogs) = OBSERVED_CATALOGS.lock() {
        let key = (
            dialect,
            observation.working_dir.clone(),
            observation.scope_id.clone(),
        );
        // A bounded in-memory cache, not another session/history store.
        if catalogs.len() >= 64 && !catalogs.contains_key(&key) {
            catalogs.clear();
        }
        catalogs.insert(key, observation.model_selector.clone());
    }
}

/// Import only the matching provider's safe extension after canonical append.
/// Called in the application process, not just the isolated process host.
pub fn cache_catalog_extension(provider_id: &str, payload: &crate::runtime::AgentEventPayload) {
    let crate::runtime::AgentEventPayload::ProviderExtension {
        provider_namespace,
        provider_event,
        payload,
    } = payload
    else {
        return;
    };
    if provider_namespace != provider_id || provider_event != ACP_CATALOG_EVENT {
        return;
    }
    let dialect = match provider_id {
        "opencode" => AcpDialect::Opencode,
        "deepseek_harness" => AcpDialect::DeepseekHarness,
        _ => return,
    };
    let Ok(observation) = serde_json::from_value::<AcpCatalogObservation>(payload.clone()) else {
        return;
    };
    if !observation.working_dir.is_absolute()
        || observation.scope_id.len() != 64
        || !observation
            .scope_id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
        || observation.model_selector.models.is_empty()
        || observation
            .model_selector
            .default_model
            .as_ref()
            .is_some_and(|id| {
                !observation
                    .model_selector
                    .models
                    .iter()
                    .any(|model| &model.id == id)
            })
    {
        return;
    }
    cache_observation(dialect, &observation);
}

pub(crate) fn observed_catalog(
    dialect: AcpDialect,
    cwd: &std::path::Path,
    identity: &str,
) -> Option<ModelSelectorConfig> {
    OBSERVED_CATALOGS
        .lock()
        .ok()?
        .get(&(dialect, cwd.to_path_buf(), identity.to_string()))
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn option(id: &str, current: &str, values: &[&str]) -> proto::SessionConfigOption {
        proto::SessionConfigOption::select(
            id.to_owned(),
            id.to_owned(),
            current.to_owned(),
            values
                .iter()
                .map(|value| {
                    proto::SessionConfigSelectOption::new(value.to_string(), value.to_string())
                })
                .collect::<Vec<_>>(),
        )
    }

    #[test]
    fn opaque_model_and_empty_effort_are_preserved() {
        let model = r#"["provider/name","model/name"]"#;
        let options = vec![
            option("model", model, &[model]),
            option("reasoning_effort", "", &["", "high"]),
        ];
        assert!(validate_selection(&options, "model", model).is_ok());
        assert!(validate_selection(&options, "reasoning_effort", "").is_ok());
        assert!(validate_selection(&options, "reasoning_effort", "max").is_err());
        assert!(validate_selection(&options, "effort", "high").is_err());
    }

    #[test]
    fn dsh_requires_advertised_resume_and_never_falls_back_to_load() {
        let mut capabilities = proto::AgentCapabilities::default();
        capabilities.load_session = true;
        assert_eq!(
            AcpDialect::Opencode.restore_method(&capabilities).unwrap(),
            NativeRestoreMethod::Load
        );
        assert!(
            AcpDialect::DeepseekHarness
                .restore_method(&capabilities)
                .is_err()
        );
        capabilities.session_capabilities.resume = Some(proto::SessionResumeCapabilities::new());
        assert_eq!(
            AcpDialect::DeepseekHarness
                .restore_method(&capabilities)
                .unwrap(),
            NativeRestoreMethod::Resume
        );
        assert_eq!(
            AcpDialect::Opencode.restore_method(&capabilities).unwrap(),
            NativeRestoreMethod::Resume
        );
    }

    #[test]
    fn reasoning_options_do_not_leak_to_other_models() {
        let cwd = PathBuf::from("catalog-test-root");
        let _ = observe_catalog(
            AcpDialect::Opencode,
            cwd.clone(),
            "profile-a".to_string(),
            &[
                option("model", "p/a", &["p/a", "p/b"]),
                option("effort", "high", &["low", "high"]),
            ],
        );
        let catalog = observed_catalog(AcpDialect::Opencode, &cwd, "profile-a").unwrap();
        assert!(catalog.providers.is_empty());
        assert_eq!(catalog.models[0].reasoning_options.len(), 2);
        assert!(catalog.models[1].reasoning_options.is_empty());
        assert!(observed_catalog(AcpDialect::Opencode, &cwd, "profile-b").is_none());
    }

    #[test]
    fn catalog_scope_ignores_platform_context_but_isolates_native_routes() {
        let baseline = crate::command::CmdOverrides::default();
        let identity = catalog_identity(&baseline);
        let mut context = baseline.clone();
        context.env = Some(std::collections::HashMap::from([
            ("VK_AGENT_RUN_ID".into(), "first-run".into()),
            ("VK_RUN_ATTEMPT_ID".into(), "first-attempt".into()),
            ("VK_WORKSPACE_ID".into(), "workspace".into()),
            ("VK_WORKSPACE_BRANCH".into(), "auto-first-branch".into()),
            (
                crate::workflow_mcp::TOKEN_ENV.into(),
                "private-workflow-token".into(),
            ),
            (crate::workflow_mcp::SESSION_ID_ENV.into(), "session".into()),
            (
                crate::workflow_mcp::BACKEND_URL_ENV.into(),
                "http://127.0.0.1:9999".into(),
            ),
            (
                crate::workflow_mcp::EXECUTABLE_ENV.into(),
                "workflow-mcp".into(),
            ),
        ]));
        assert_eq!(catalog_identity(&context), identity);
        context
            .env
            .as_mut()
            .unwrap()
            .insert("VK_AGENT_RUN_ID".into(), "next-run".into());
        context
            .env
            .as_mut()
            .unwrap()
            .insert("VK_WORKSPACE_BRANCH".into(), "auto-next-branch".into());
        assert_eq!(catalog_identity(&context), identity);
        assert_eq!(identity.len(), 64);
        assert!(!identity.contains("private-workflow-token"));

        let mut command = baseline.clone();
        command.base_command_override = Some("custom-opencode".into());
        assert_ne!(catalog_identity(&command), identity);
        command = baseline.clone();
        command.additional_params = Some(vec!["--custom-profile".into()]);
        assert_ne!(catalog_identity(&command), identity);
        for key in [
            "OPENCODE_CONFIG",
            "DSH_HOME",
            "XDG_CONFIG_HOME",
            "HOME",
            "CUSTOM_MODEL_ROUTE",
        ] {
            let mut routed = baseline.clone();
            routed.env = Some(std::collections::HashMap::from([(
                key.into(),
                "native-route-a".into(),
            )]));
            let route_a = catalog_identity(&routed);
            assert_ne!(route_a, identity, "{key}");
            routed
                .env
                .as_mut()
                .unwrap()
                .insert(key.into(), "native-route-b".into());
            assert_ne!(catalog_identity(&routed), route_a, "{key}");
        }
    }

    #[test]
    fn model_switch_replaces_catalog_and_never_copies_previous_effort() {
        let directory = tempfile::tempdir().unwrap();
        let cwd = directory.path().to_path_buf();
        let identity = catalog_identity(&crate::command::CmdOverrides::default());
        let _ = observe_catalog(
            AcpDialect::Opencode,
            cwd.clone(),
            identity.clone(),
            &[
                option("model", "p/a", &["p/a", "p/b"]),
                option("effort", "high", &["high"]),
            ],
        );
        let _ = observe_catalog(
            AcpDialect::Opencode,
            cwd.clone(),
            identity.clone(),
            &[
                option("model", "p/b", &["p/a", "p/b", "p/b"]),
                option("effort", "", &[""]),
                option(
                    "private_api_key",
                    "native-private-value",
                    &["native-private-value"],
                ),
            ],
        );
        let catalog = observed_catalog(AcpDialect::Opencode, &cwd, &identity).unwrap();
        assert_eq!(catalog.default_model.as_deref(), Some("p/b"));
        assert_eq!(catalog.models.len(), 2);
        assert!(catalog.models[0].reasoning_options.is_empty());
        assert_eq!(catalog.models[1].reasoning_options[0].id, "");
        assert!(
            !serde_json::to_string(&catalog)
                .unwrap()
                .contains("native-private-value")
        );
    }

    #[test]
    fn serialized_observation_imports_only_the_matching_provider_scope() {
        let directory = tempfile::tempdir().unwrap();
        let identity = catalog_identity(&crate::command::CmdOverrides::default());
        let observation = AcpCatalogObservation {
            working_dir: directory.path().to_path_buf(),
            scope_id: identity.clone(),
            model_selector: ModelSelectorConfig {
                models: vec![ModelInfo {
                    id: "opaque/model".into(),
                    name: "Model".into(),
                    provider_id: None,
                    reasoning_options: vec![ReasoningOption {
                        id: "".into(),
                        label: "No effort".into(),
                        is_default: true,
                    }],
                }],
                default_model: Some("opaque/model".into()),
                ..Default::default()
            },
        };
        let extension = crate::runtime::AgentEventPayload::ProviderExtension {
            provider_namespace: "deepseek_harness".into(),
            provider_event: ACP_CATALOG_EVENT.into(),
            payload: serde_json::to_value(&observation).unwrap(),
        };
        let transported = serde_json::from_str::<crate::runtime::AgentEventPayload>(
            &serde_json::to_string(&extension).unwrap(),
        )
        .unwrap();
        assert!(
            observed_catalog(AcpDialect::DeepseekHarness, directory.path(), &identity).is_none()
        );
        cache_catalog_extension("opencode", &transported);
        assert!(
            observed_catalog(AcpDialect::DeepseekHarness, directory.path(), &identity).is_none()
        );
        cache_catalog_extension("deepseek_harness", &transported);
        assert_eq!(
            observed_catalog(AcpDialect::DeepseekHarness, directory.path(), &identity)
                .unwrap()
                .models[0]
                .reasoning_options[0]
                .id,
            ""
        );
        assert!(observed_catalog(AcpDialect::Opencode, directory.path(), &identity).is_none());
        assert!(
            observed_catalog(
                AcpDialect::DeepseekHarness,
                directory.path(),
                &"f".repeat(64)
            )
            .is_none()
        );
    }
}
