use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::executors::{AvailabilityInfo, BaseAgentCapability, BaseCodingAgent, CodingAgent};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(use_ts_enum)]
pub enum AgentProviderReadiness {
    Unknown,
    Ready,
    Installed,
    MissingExecutable,
    AuthRequired,
    Misconfigured,
    Unsupported,
    Disabled,
    Degraded,
}

impl AgentProviderReadiness {
    pub fn from_availability(availability: &AvailabilityInfo) -> Self {
        match availability {
            AvailabilityInfo::LoginDetected { .. } => Self::Ready,
            AvailabilityInfo::InstallationFound => Self::Installed,
            AvailabilityInfo::NotFound => Self::MissingExecutable,
        }
    }

    pub fn is_usable(self) -> bool {
        matches!(self, Self::Ready | Self::Installed | Self::Degraded)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(use_ts_enum)]
pub enum AgentProviderCapability {
    InitialRun,
    FollowUp,
    SessionResume,
    SessionFork,
    GracefulCancel,
    ToolPermissions,
    Mcp,
    SetupHelper,
    ContextUsage,
    ModelSelector,
    ObservedConfig,
    WorkflowAgentStep,
    TeamSlot,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[ts(use_ts_enum)]
pub enum AgentProviderDiagnosticKind {
    MissingExecutable,
    AuthRequired,
    ConfigMissing,
    UnsupportedPlatform,
    DisabledByPolicy,
    LegacyLimited,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct AgentProviderDiagnostic {
    pub kind: AgentProviderDiagnosticKind,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, TS)]
pub struct AgentProviderPolicy {
    pub executor: BaseCodingAgent,
    pub readiness: AgentProviderReadiness,
    pub capabilities: Vec<AgentProviderCapability>,
    pub legacy: bool,
    pub disabled: bool,
    #[serde(default)]
    pub diagnostics: Vec<AgentProviderDiagnostic>,
}

impl AgentProviderPolicy {
    pub fn for_agent(
        executor: BaseCodingAgent,
        agent: &CodingAgent,
        availability: AvailabilityInfo,
    ) -> Self {
        let readiness = AgentProviderReadiness::from_availability(&availability);
        let mut capabilities = capabilities_for_agent(agent);

        if !readiness.is_usable() {
            capabilities.retain(|capability| {
                !matches!(
                    capability,
                    AgentProviderCapability::InitialRun
                        | AgentProviderCapability::FollowUp
                        | AgentProviderCapability::SessionResume
                        | AgentProviderCapability::WorkflowAgentStep
                        | AgentProviderCapability::TeamSlot
                )
            });
        }

        Self {
            executor,
            readiness,
            capabilities,
            legacy: false,
            disabled: false,
            diagnostics: diagnostics_for_availability(&availability),
        }
    }
}

fn capabilities_for_agent(agent: &CodingAgent) -> Vec<AgentProviderCapability> {
    let base_capabilities = agent.capabilities();
    let mut capabilities = vec![
        AgentProviderCapability::InitialRun,
        AgentProviderCapability::WorkflowAgentStep,
    ];

    if agent_supports_follow_up(agent) {
        capabilities.push(AgentProviderCapability::FollowUp);
        capabilities.push(AgentProviderCapability::SessionResume);
    }

    if agent.supports_mcp() {
        capabilities.push(AgentProviderCapability::Mcp);
    }

    if agent_supports_graceful_cancel(agent) {
        push_unique(&mut capabilities, AgentProviderCapability::GracefulCancel);
    }

    if agent_supports_observed_config(agent) {
        push_unique(&mut capabilities, AgentProviderCapability::ObservedConfig);
    }

    for base in base_capabilities {
        match base {
            BaseAgentCapability::SessionFork => {
                push_unique(&mut capabilities, AgentProviderCapability::SessionFork);
            }
            BaseAgentCapability::SetupHelper => {
                push_unique(&mut capabilities, AgentProviderCapability::SetupHelper);
            }
            BaseAgentCapability::ContextUsage => {
                push_unique(&mut capabilities, AgentProviderCapability::ContextUsage);
            }
        }
    }

    match agent {
        CodingAgent::ClaudeCode(_) | CodingAgent::Codex(_) | CodingAgent::Gemini(_) => {
            push_unique(&mut capabilities, AgentProviderCapability::ToolPermissions);
        }
        _ => {}
    }

    match agent {
        CodingAgent::ClaudeCode(_)
        | CodingAgent::Codex(_)
        | CodingAgent::Gemini(_)
        | CodingAgent::Opencode(_)
        | CodingAgent::CursorAgent(_)
        | CodingAgent::QwenCode(_)
        | CodingAgent::Droid(_)
        | CodingAgent::Copilot(_) => {
            push_unique(&mut capabilities, AgentProviderCapability::ModelSelector);
        }
        CodingAgent::Amp(_) => {}
        #[cfg(feature = "qa-mode")]
        CodingAgent::QaMock(_) => {}
    }

    match agent {
        CodingAgent::ClaudeCode(_) | CodingAgent::Codex(_) | CodingAgent::Opencode(_) => {
            push_unique(&mut capabilities, AgentProviderCapability::TeamSlot);
        }
        _ => {}
    }

    capabilities
}

fn agent_supports_follow_up(agent: &CodingAgent) -> bool {
    !matches!(agent, CodingAgent::Amp(_))
}

fn agent_supports_graceful_cancel(agent: &CodingAgent) -> bool {
    matches!(
        agent,
        CodingAgent::ClaudeCode(_)
            | CodingAgent::Codex(_)
            | CodingAgent::Gemini(_)
            | CodingAgent::Opencode(_)
            | CodingAgent::QwenCode(_)
            | CodingAgent::Copilot(_)
    )
}

fn agent_supports_observed_config(agent: &CodingAgent) -> bool {
    matches!(
        agent,
        CodingAgent::ClaudeCode(_)
            | CodingAgent::Codex(_)
            | CodingAgent::Opencode(_)
            | CodingAgent::CursorAgent(_)
    )
}

fn diagnostics_for_availability(availability: &AvailabilityInfo) -> Vec<AgentProviderDiagnostic> {
    match availability {
        AvailabilityInfo::NotFound => vec![AgentProviderDiagnostic {
            kind: AgentProviderDiagnosticKind::MissingExecutable,
            message: "Agent executable or local configuration was not found.".to_string(),
        }],
        AvailabilityInfo::InstallationFound => vec![AgentProviderDiagnostic {
            kind: AgentProviderDiagnosticKind::AuthRequired,
            message: "Agent installation was found, but authenticated readiness was not confirmed."
                .to_string(),
        }],
        AvailabilityInfo::LoginDetected { .. } => vec![],
    }
}

fn push_unique<T: PartialEq>(items: &mut Vec<T>, item: T) {
    if !items.contains(&item) {
        items.push(item);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::executors::{AppendPrompt, cursor::CursorAgent};

    fn codex_agent() -> CodingAgent {
        CodingAgent::Codex(
            serde_json::from_value(serde_json::json!({
                "ask_for_approval": "on-request"
            }))
            .expect("codex config should deserialize"),
        )
    }

    fn claude_agent() -> CodingAgent {
        CodingAgent::ClaudeCode(
            serde_json::from_value(serde_json::json!({}))
                .expect("claude config should deserialize"),
        )
    }

    #[test]
    fn readiness_maps_legacy_availability() {
        assert_eq!(
            AgentProviderReadiness::from_availability(&AvailabilityInfo::LoginDetected {
                last_auth_timestamp: 123
            }),
            AgentProviderReadiness::Ready
        );
        assert_eq!(
            AgentProviderReadiness::from_availability(&AvailabilityInfo::InstallationFound),
            AgentProviderReadiness::Installed
        );
        assert_eq!(
            AgentProviderReadiness::from_availability(&AvailabilityInfo::NotFound),
            AgentProviderReadiness::MissingExecutable
        );
    }

    #[test]
    fn unavailable_policy_strips_run_capabilities_but_keeps_setup_metadata() {
        let agent = codex_agent();

        let policy = AgentProviderPolicy::for_agent(
            BaseCodingAgent::Codex,
            &agent,
            AvailabilityInfo::NotFound,
        );

        assert_eq!(policy.readiness, AgentProviderReadiness::MissingExecutable);
        assert!(
            !policy
                .capabilities
                .contains(&AgentProviderCapability::InitialRun)
        );
        assert!(
            policy
                .capabilities
                .contains(&AgentProviderCapability::SetupHelper)
        );
        assert_eq!(
            policy.diagnostics.first().map(|diagnostic| diagnostic.kind),
            Some(AgentProviderDiagnosticKind::MissingExecutable)
        );
    }

    #[test]
    fn codex_policy_includes_runtime_capabilities_when_ready() {
        let agent = codex_agent();

        let policy = AgentProviderPolicy::for_agent(
            BaseCodingAgent::Codex,
            &agent,
            AvailabilityInfo::LoginDetected {
                last_auth_timestamp: 123,
            },
        );

        assert_eq!(policy.readiness, AgentProviderReadiness::Ready);
        assert!(
            policy
                .capabilities
                .contains(&AgentProviderCapability::InitialRun)
        );
        assert!(
            policy
                .capabilities
                .contains(&AgentProviderCapability::FollowUp)
        );
        assert!(policy.capabilities.contains(&AgentProviderCapability::Mcp));
        assert!(
            policy
                .capabilities
                .contains(&AgentProviderCapability::ToolPermissions)
        );
        assert!(
            policy
                .capabilities
                .contains(&AgentProviderCapability::GracefulCancel)
        );
        assert!(
            policy
                .capabilities
                .contains(&AgentProviderCapability::ObservedConfig)
        );
        assert!(
            policy
                .capabilities
                .contains(&AgentProviderCapability::TeamSlot)
        );
    }

    #[test]
    fn cursor_policy_preserves_platform_setup_helper_capability() {
        let agent = CodingAgent::CursorAgent(CursorAgent {
            append_prompt: AppendPrompt::default(),
            force: None,
            model: None,
            reasoning: None,
            cmd: Default::default(),
        });

        let policy = AgentProviderPolicy::for_agent(
            BaseCodingAgent::CursorAgent,
            &agent,
            AvailabilityInfo::InstallationFound,
        );

        assert_eq!(policy.readiness, AgentProviderReadiness::Installed);
        assert_eq!(
            policy
                .capabilities
                .contains(&AgentProviderCapability::SetupHelper),
            cfg!(unix)
        );
    }

    #[test]
    fn claude_policy_includes_session_and_team_capabilities() {
        let agent = claude_agent();

        let policy = AgentProviderPolicy::for_agent(
            BaseCodingAgent::ClaudeCode,
            &agent,
            AvailabilityInfo::LoginDetected {
                last_auth_timestamp: 123,
            },
        );

        assert!(
            policy
                .capabilities
                .contains(&AgentProviderCapability::SessionFork)
        );
        assert!(
            policy
                .capabilities
                .contains(&AgentProviderCapability::ContextUsage)
        );
        assert!(
            policy
                .capabilities
                .contains(&AgentProviderCapability::TeamSlot)
        );
        assert!(
            policy
                .capabilities
                .contains(&AgentProviderCapability::GracefulCancel)
        );
        assert!(
            policy
                .capabilities
                .contains(&AgentProviderCapability::ObservedConfig)
        );
    }
}
