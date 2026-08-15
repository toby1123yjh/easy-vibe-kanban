//! Provider-neutral entry points for the four direct V1 runtime adapters.
//!
//! Legacy product paths may still use `StandardCodingAgentExecutor`, while the
//! V1 runtime launches the same concrete providers through the narrow API in
//! this module. Native bytes are decoded once here, then mapped to canonical
//! events. Consumers must not parse provider output themselves.

use std::{path::Path, sync::Arc};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    actions::SelectedSkill,
    approvals::ExecutorApprovalService,
    command::{CmdOverrides, CommandBuildError, CommandBuilder, apply_overrides},
    env::ExecutionEnv,
    executors::{CodingAgent, ExecutorError, SpawnedChild},
    profile::{ExecutorConfig, ExecutorConfigs},
    runtime::{
        AGENT_EVENT_PAYLOAD_VERSION, AGENT_EVENT_SCHEMA_VERSION, AgentEvent, AgentEventEnvelope,
        AgentEventPayload, AgentRunStatus, AgentRuntimeError, AgentRuntimeErrorKind,
        AgentRuntimeMessageRole, AgentRuntimeToolStatus, AgentTransportKind, CapabilitySnapshot,
        CapabilitySnapshotEntry, CapabilitySource, CapabilityState, NativeAuditError,
        NativeAuditFrame, NativeAuditManifest, NativeAuditReplayMapper, NativeAuditVersionSet,
        ProviderEvent, ProviderSessionReference,
    },
};

/// Everything needed to launch one real provider process without constructing
/// a legacy `ExecutorAction` or routing through `StandardCodingAgentExecutor`.
pub struct DirectProviderLaunchRequest<'a> {
    pub provider: DirectProvider,
    pub executor_config: &'a ExecutorConfig,
    pub intent: DirectIntent,
    pub prompt: &'a str,
    pub provider_session: Option<&'a ProviderSessionReference>,
    pub reset_to_message_id: Option<&'a str>,
    pub selected_skills: &'a [SelectedSkill],
    pub approvals: Arc<dyn ExecutorApprovalService>,
    pub current_dir: &'a Path,
    pub env: &'a ExecutionEnv,
}

/// Resolve the requested profile and launch the provider through its concrete
/// adapter. Profile overrides, approvals, reviews, and Codex selected skills
/// retain the same behavior as the existing product launch path.
pub async fn launch_direct_provider(
    request: DirectProviderLaunchRequest<'_>,
) -> Result<SpawnedChild, ExecutorError> {
    validate_direct_launch(&request)?;

    let profile_id = request.executor_config.profile_id();
    let mut agent = ExecutorConfigs::get_cached()
        .get_coding_agent(&profile_id)
        .ok_or_else(|| ExecutorError::UnknownExecutorType(profile_id.to_string()))?;
    if DirectProvider::from_agent(&agent) != Some(request.provider) {
        return Err(profile_provider_mismatch(
            request.provider,
            request.executor_config,
        ));
    }

    match &mut agent {
        CodingAgent::Gemini(agent) => {
            agent.apply_direct_overrides(request.executor_config);
            agent.use_direct_approvals(request.approvals);
            agent
                .launch_direct(
                    request.intent,
                    request.current_dir,
                    request.prompt,
                    provider_session_id(request.provider_session),
                    request.env,
                )
                .await
        }
        CodingAgent::Codex(agent) => {
            agent.apply_direct_overrides(request.executor_config);
            agent.use_direct_approvals(request.approvals);
            agent
                .launch_direct(
                    request.intent,
                    request.current_dir,
                    request.prompt,
                    provider_session_id(request.provider_session),
                    request.selected_skills,
                    request.env,
                )
                .await
        }
        CodingAgent::ClaudeCode(agent) => {
            agent.apply_direct_overrides(request.executor_config);
            agent.use_direct_approvals(request.approvals);
            agent
                .launch_direct(
                    request.intent,
                    request.current_dir,
                    request.prompt,
                    provider_session_id(request.provider_session),
                    request.reset_to_message_id,
                    request.env,
                )
                .await
        }
        CodingAgent::OhMyPi(agent) => {
            agent.apply_direct_overrides(request.executor_config);
            agent
                .launch_direct(
                    request.intent,
                    request.current_dir,
                    request.prompt,
                    provider_session_id(request.provider_session),
                    request.env,
                )
                .await
        }
        #[cfg(feature = "qa-mode")]
        CodingAgent::QaMock(_) => Err(profile_provider_mismatch(
            request.provider,
            request.executor_config,
        )),
    }
}

fn validate_direct_launch(request: &DirectProviderLaunchRequest<'_>) -> Result<(), ExecutorError> {
    let configured_provider = DirectProvider::from_base_agent(request.executor_config.executor)
        .ok_or_else(|| profile_provider_mismatch(request.provider, request.executor_config))?;
    if configured_provider != request.provider {
        return Err(profile_provider_mismatch(
            request.provider,
            request.executor_config,
        ));
    }

    let profile_id = request.executor_config.profile_id().cache_key();
    if let Some(session) = request.provider_session {
        session.validate_current().map_err(|error| {
            ExecutorError::FollowUpNotSupported(format!(
                "invalid provider session for {}: {error}",
                request.provider.id()
            ))
        })?;
        if session.provider_id != request.provider.id()
            || session.runtime_profile_id != profile_id
            || session.provider_session_id.trim().is_empty()
        {
            return Err(ExecutorError::FollowUpNotSupported(format!(
                "provider session does not match {} profile {profile_id}",
                request.provider.id()
            )));
        }
    }

    match request.intent {
        DirectIntent::Initial if request.provider_session.is_some() => {
            return Err(ExecutorError::FollowUpNotSupported(
                "initial launch cannot attach a provider session".to_string(),
            ));
        }
        DirectIntent::FollowUp | DirectIntent::Resume if request.provider_session.is_none() => {
            return Err(ExecutorError::FollowUpNotSupported(format!(
                "{} requires an explicit provider session",
                request.provider.id()
            )));
        }
        _ => {}
    }

    if request.reset_to_message_id.is_some()
        && (request.provider != DirectProvider::ClaudeCode
            || !matches!(
                request.intent,
                DirectIntent::FollowUp | DirectIntent::Resume
            ))
    {
        return Err(ExecutorError::ResetToMessageNotSupported(format!(
            "{} does not support message-level reset for {:?}",
            request.provider.id(),
            request.intent
        )));
    }

    Ok(())
}

fn provider_session_id(session: Option<&ProviderSessionReference>) -> Option<&str> {
    session.map(|session| session.provider_session_id.as_str())
}

fn profile_provider_mismatch(
    provider: DirectProvider,
    executor_config: &ExecutorConfig,
) -> ExecutorError {
    ExecutorError::UnknownExecutorType(format!(
        "direct provider {} does not match executor profile {}",
        provider.id(),
        executor_config.profile_id()
    ))
}

/// The only provider products included in the V1 adapter gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectProvider {
    Gemini,
    Codex,
    ClaudeCode,
    OhMyPi,
}

impl DirectProvider {
    pub const ALL: [Self; 4] = [Self::Gemini, Self::Codex, Self::ClaudeCode, Self::OhMyPi];

    pub const fn id(self) -> &'static str {
        match self {
            Self::Gemini => "gemini",
            Self::Codex => "codex",
            Self::ClaudeCode => "claude_code",
            Self::OhMyPi => "oh_my_pi",
        }
    }

    pub const fn from_base_agent(agent: crate::executors::BaseCodingAgent) -> Option<Self> {
        match agent {
            crate::executors::BaseCodingAgent::Gemini => Some(Self::Gemini),
            crate::executors::BaseCodingAgent::Codex => Some(Self::Codex),
            crate::executors::BaseCodingAgent::ClaudeCode => Some(Self::ClaudeCode),
            crate::executors::BaseCodingAgent::OhMyPi => Some(Self::OhMyPi),
            #[cfg(feature = "qa-mode")]
            crate::executors::BaseCodingAgent::QaMock => None,
        }
    }

    pub fn from_agent(agent: &CodingAgent) -> Option<Self> {
        Self::from_base_agent(crate::executors::BaseCodingAgent::from(agent))
    }

    pub const fn transport(self) -> AgentTransportKind {
        match self {
            Self::Gemini => AgentTransportKind::Acp,
            Self::Codex => AgentTransportKind::AppServerJsonrpc,
            Self::ClaudeCode => AgentTransportKind::StdioRpc,
            Self::OhMyPi => AgentTransportKind::StdioRpc,
        }
    }

    pub const fn versions(self) -> DirectAdapterVersions {
        match self {
            Self::Gemini => DirectAdapterVersions {
                executable: "gemini",
                runtime: None,
                protocol: Some("acp-0.8"),
                adapter: "gemini-adapter-v1",
                mapper: "gemini-mapper-v1",
            },
            Self::Codex => DirectAdapterVersions {
                executable: "codex",
                runtime: Some("0.144.1"),
                protocol: Some("rust-v0.144.1"),
                adapter: "codex-adapter-v1",
                mapper: "codex-mapper-v1",
            },
            Self::ClaudeCode => DirectAdapterVersions {
                executable: "claude",
                runtime: None,
                protocol: Some("stream-json-v1"),
                adapter: "claude-code-adapter-v1",
                mapper: "claude-code-mapper-v1",
            },
            Self::OhMyPi => DirectAdapterVersions {
                executable: "omp",
                runtime: None,
                protocol: Some("stdio-rpc-ndjson-v1"),
                adapter: "oh-my-pi-adapter-v1",
                mapper: "oh-my-pi-mapper-v1",
            },
        }
    }

    pub fn version_set(self) -> NativeAuditVersionSet {
        let versions = self.versions();
        NativeAuditVersionSet {
            audit_schema_version: crate::runtime::NATIVE_AUDIT_SCHEMA_VERSION,
            runtime_version: versions.runtime.map(str::to_owned),
            adapter_version: versions.adapter.to_owned(),
            protocol_version: versions.protocol.map(str::to_owned),
            mapper_version: versions.mapper.to_owned(),
        }
    }

    pub fn command(
        self,
        intent: DirectIntent,
        session_id: Option<&str>,
        overrides: &CmdOverrides,
    ) -> Result<CommandBuilder, CommandBuildError> {
        let versions = self.versions();
        let mut builder = CommandBuilder::new(versions.executable);
        match self {
            Self::Gemini => {
                builder = builder.extend_params(["--experimental-acp"]);
            }
            Self::Codex => {
                builder = builder.extend_params(["app-server"]);
            }
            Self::ClaudeCode => {
                builder = builder.extend_params(["-p"]);
                if matches!(intent, DirectIntent::FollowUp | DirectIntent::Review)
                    && let Some(session_id) = session_id
                {
                    builder = builder.extend_params(["--resume", session_id]);
                }
                builder = builder.extend_params([
                    "--verbose",
                    "--output-format=stream-json",
                    "--input-format=stream-json",
                ]);
            }
            // Oh My Pi's RPC request is written to stdin after launch.  The
            // session id is deliberately not smuggled into command arguments.
            Self::OhMyPi => builder = builder.extend_params(["--mode", "rpc"]),
        }
        apply_overrides(builder, overrides)
    }

    pub fn capabilities(self, runtime_profile_id: impl Into<String>) -> CapabilitySnapshot {
        let versions = self.versions();
        let states = match self {
            Self::Gemini => capability_states(&[
                (
                    crate::runtime::AgentCapability::SessionResume,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Steering,
                    CapabilityState::Unsupported,
                ),
                (
                    crate::runtime::AgentCapability::Approval,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Images,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Review,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Mcp,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Subagents,
                    CapabilityState::Unknown,
                ),
                (
                    crate::runtime::AgentCapability::TokenUsage,
                    CapabilityState::Native,
                ),
            ]),
            Self::Codex => capability_states(&[
                (
                    crate::runtime::AgentCapability::SessionResume,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Steering,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Approval,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Images,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Review,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Mcp,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Subagents,
                    CapabilityState::Unknown,
                ),
                (
                    crate::runtime::AgentCapability::TokenUsage,
                    CapabilityState::Native,
                ),
            ]),
            Self::ClaudeCode => capability_states(&[
                (
                    crate::runtime::AgentCapability::SessionResume,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Steering,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Approval,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Images,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Review,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Mcp,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Subagents,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::TokenUsage,
                    CapabilityState::Native,
                ),
            ]),
            Self::OhMyPi => capability_states(&[
                (
                    crate::runtime::AgentCapability::SessionResume,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Steering,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Approval,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Images,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Review,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Mcp,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::Subagents,
                    CapabilityState::Native,
                ),
                (
                    crate::runtime::AgentCapability::TokenUsage,
                    CapabilityState::Native,
                ),
            ]),
        };
        CapabilitySnapshot {
            schema_version: crate::runtime::CAPABILITY_SNAPSHOT_SCHEMA_VERSION,
            runtime_profile_id: runtime_profile_id.into(),
            provider_id: self.id().to_string(),
            runtime_version: versions.runtime.map(str::to_owned),
            protocol_version: versions.protocol.map(str::to_owned),
            adapter_version: versions.adapter.to_string(),
            resolved_at: Utc::now(),
            capabilities: states,
        }
    }

    pub fn mapper(self) -> DirectProviderMapper {
        DirectProviderMapper { provider: self }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DirectAdapterVersions {
    pub executable: &'static str,
    pub runtime: Option<&'static str>,
    pub protocol: Option<&'static str>,
    pub adapter: &'static str,
    pub mapper: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DirectIntent {
    Initial,
    FollowUp,
    Review,
    Resume,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DirectControl {
    Cancel,
    Approve {
        request_id: String,
        approved: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    Input {
        request_id: String,
        text: String,
    },
    Steer {
        text: String,
    },
}

impl DirectControl {
    fn capability(&self) -> Option<crate::runtime::AgentCapability> {
        match self {
            Self::Cancel => None,
            Self::Approve { .. } => Some(crate::runtime::AgentCapability::Approval),
            Self::Input { .. } => None,
            Self::Steer { .. } => Some(crate::runtime::AgentCapability::Steering),
        }
    }
}

/// Encode one provider-native control frame after checking the frozen attempt
/// capability snapshot.  Unsupported/unknown capabilities never fall through
/// to another control shape.
pub fn encode_control(
    provider: DirectProvider,
    snapshot: &CapabilitySnapshot,
    control: DirectControl,
) -> Result<Vec<u8>, DirectControlError> {
    if let Some(capability) = control.capability() {
        require_capability(provider, snapshot, capability, false)?;
    }
    let request = match (provider, control) {
        (DirectProvider::Gemini, DirectControl::Cancel) => {
            serde_json::json!({"jsonrpc":"2.0","method":"session/cancel","params":{}})
        }
        (DirectProvider::Codex, DirectControl::Cancel) => {
            serde_json::json!({"method":"turn/interrupt","params":{}})
        }
        (DirectProvider::ClaudeCode, DirectControl::Cancel) => {
            serde_json::json!({"type":"control_request","request":{"subtype":"interrupt"}})
        }
        (DirectProvider::OhMyPi, DirectControl::Cancel) => {
            serde_json::json!({"jsonrpc":"2.0","method":"session/abort","params":{}})
        }
        (
            DirectProvider::Gemini,
            DirectControl::Approve {
                request_id,
                approved,
                reason,
            },
        ) => {
            serde_json::json!({"jsonrpc":"2.0","method":"session/request_permission/response","params":{"request_id":request_id,"approved":approved,"reason":reason}})
        }
        (
            DirectProvider::Codex,
            DirectControl::Approve {
                request_id,
                approved,
                reason,
            },
        ) => {
            serde_json::json!({"method":"approval/respond","params":{"request_id":request_id,"approved":approved,"reason":reason}})
        }
        (
            DirectProvider::ClaudeCode,
            DirectControl::Approve {
                request_id,
                approved,
                reason,
            },
        ) => {
            serde_json::json!({"type":"control_response","response":{"request_id":request_id,"approved":approved,"reason":reason}})
        }
        (
            DirectProvider::OhMyPi,
            DirectControl::Approve {
                request_id,
                approved,
                reason,
            },
        ) => {
            serde_json::json!({"jsonrpc":"2.0","method":"permission/respond","params":{"request_id":request_id,"approved":approved,"reason":reason}})
        }
        (DirectProvider::Gemini, DirectControl::Input { request_id, text }) => {
            serde_json::json!({"jsonrpc":"2.0","method":"session/input","params":{"request_id":request_id,"text":text}})
        }
        (DirectProvider::Codex, DirectControl::Input { request_id, text }) => {
            serde_json::json!({"method":"user-input/respond","params":{"request_id":request_id,"text":text}})
        }
        (DirectProvider::ClaudeCode, DirectControl::Input { request_id, text }) => {
            serde_json::json!({"type":"control_response","response":{"request_id":request_id,"answer":text}})
        }
        (DirectProvider::OhMyPi, DirectControl::Input { request_id, text }) => {
            serde_json::json!({"jsonrpc":"2.0","method":"input/respond","params":{"request_id":request_id,"text":text}})
        }
        (DirectProvider::Gemini, DirectControl::Steer { text }) => {
            serde_json::json!({"jsonrpc":"2.0","method":"session/prompt","params":{"prompt":text}})
        }
        (DirectProvider::Codex, DirectControl::Steer { text }) => {
            serde_json::json!({"method":"turn/steer","params":{"input":[{"type":"text","text":text}]}})
        }
        (DirectProvider::ClaudeCode, DirectControl::Steer { text }) => {
            serde_json::json!({"type":"user","message":{"role":"user","content":text}})
        }
        (DirectProvider::OhMyPi, DirectControl::Steer { text }) => {
            serde_json::json!({"jsonrpc":"2.0","method":"session/steer","params":{"text":text}})
        }
    };
    encode_stdio_rpc(&request).map_err(DirectControlError::Json)
}

#[derive(Debug, thiserror::Error)]
pub enum DirectControlError {
    #[error(transparent)]
    Capability(#[from] CapabilityGateError),
    #[error(transparent)]
    Json(serde_json::Error),
}

fn capability_states(
    values: &[(crate::runtime::AgentCapability, CapabilityState)],
) -> Vec<CapabilitySnapshotEntry> {
    values
        .iter()
        .map(|(capability, state)| CapabilitySnapshotEntry {
            capability: *capability,
            state: *state,
            source: CapabilitySource::RuntimeProfile,
            emulation_policy: None,
            evidence: Some(serde_json::json!({ "provider_profile": "v1" })),
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CapabilityGateError {
    #[error("capability {capability:?} is unresolved for {provider}")]
    Unresolved {
        provider: String,
        capability: crate::runtime::AgentCapability,
    },
    #[error("capability {capability:?} is unsupported for {provider}")]
    Unsupported {
        provider: String,
        capability: crate::runtime::AgentCapability,
    },
    #[error("emulated capability {capability:?} requires explicit policy approval")]
    EmulationNotAllowed {
        capability: crate::runtime::AgentCapability,
    },
}

pub fn require_capability(
    provider: DirectProvider,
    snapshot: &CapabilitySnapshot,
    capability: crate::runtime::AgentCapability,
    allow_emulated: bool,
) -> Result<(), CapabilityGateError> {
    match snapshot.resolve(capability) {
        CapabilityState::Native => Ok(()),
        CapabilityState::Emulated if allow_emulated => Ok(()),
        CapabilityState::Emulated => Err(CapabilityGateError::EmulationNotAllowed { capability }),
        CapabilityState::Unsupported => Err(CapabilityGateError::Unsupported {
            provider: provider.id().to_string(),
            capability,
        }),
        CapabilityState::Unknown => Err(CapabilityGateError::Unresolved {
            provider: provider.id().to_string(),
            capability,
        }),
    }
}

/// Typed provider semantics produced by the one native-frame decode.
#[derive(Debug, Clone, PartialEq)]
pub enum TypedProviderEvent {
    Lifecycle(AgentRunStatus),
    SessionObserved(String),
    Message {
        role: AgentRuntimeMessageRole,
        content: String,
        final_output: bool,
    },
    Thinking(String),
    ToolCall {
        id: Option<String>,
        name: String,
        status: AgentRuntimeToolStatus,
        arguments: Option<Value>,
        result: Option<Value>,
    },
    ApprovalRequested {
        id: String,
        tool_call_id: Option<String>,
        tool_name: String,
    },
    ApprovalResolved {
        id: String,
        approved: bool,
        reason: Option<String>,
    },
    InputRequested {
        id: String,
        prompt: String,
    },
    InputResolved {
        id: String,
        answered: bool,
    },
    TokenUsage {
        input_tokens: u64,
        output_tokens: u64,
        cached_input_tokens: Option<u64>,
    },
    Error(AgentRuntimeError),
    Unknown {
        event_type: String,
        payload: Value,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecodedProviderEvent {
    pub raw: ProviderEvent,
    pub typed: TypedProviderEvent,
}

impl DirectProvider {
    pub fn decode_native_frame(
        self,
        frame: &NativeAuditFrame,
    ) -> Result<DecodedProviderEvent, NativeAuditError> {
        let raw = crate::runtime::DefaultNativeAuditMapper::for_manifest(&fixture_manifest(self))
            .decode(frame)?;
        let typed = classify_payload(self, &raw)?;
        Ok(DecodedProviderEvent { raw, typed })
    }

    pub fn map_provider_event(
        self,
        event: &DecodedProviderEvent,
        manifest: &NativeAuditManifest,
    ) -> Result<Vec<AgentEvent>, NativeAuditError> {
        map_typed_event(self, event, manifest)
    }
}

/// Replay mapper used by `AuditBundle::replay`; all four adapters share the
/// canonical envelope construction while retaining provider-specific names.
#[derive(Debug, Clone, Copy)]
pub struct DirectProviderMapper {
    pub provider: DirectProvider,
}

impl NativeAuditReplayMapper for DirectProviderMapper {
    fn versions(&self) -> NativeAuditVersionSet {
        self.provider.version_set()
    }

    fn decode(&self, frame: &NativeAuditFrame) -> Result<ProviderEvent, NativeAuditError> {
        Ok(self.provider.decode_native_frame(frame)?.raw)
    }

    fn map(
        &self,
        event: &ProviderEvent,
        manifest: &NativeAuditManifest,
    ) -> Result<Vec<AgentEvent>, NativeAuditError> {
        let typed = classify_payload(self.provider, event)?;
        map_typed_event(
            self.provider,
            &DecodedProviderEvent {
                raw: event.clone(),
                typed,
            },
            manifest,
        )
    }
}

fn fixture_manifest(provider: DirectProvider) -> NativeAuditManifest {
    // Only used to invoke the existing lossless frame decoder.  The returned
    // ProviderEvent's native reference is replaced with the real manifest by
    // AuditBundle::replay.
    let now = Utc::now();
    NativeAuditManifest {
        audit_schema_version: crate::runtime::NATIVE_AUDIT_SCHEMA_VERSION,
        session_id: Uuid::nil(),
        agent_run_id: Uuid::nil(),
        turn_id: Uuid::nil(),
        run_attempt_id: Uuid::nil(),
        run_attempt_number: 1,
        provider_id: provider.id().to_string(),
        runtime_profile_id: "fixture".to_string(),
        workspace_path: String::new(),
        runtime_version: provider.versions().runtime.map(str::to_owned),
        protocol_version: provider.versions().protocol.map(str::to_owned),
        adapter_version: provider.versions().adapter.to_string(),
        mapper_version: provider.versions().mapper.to_string(),
        frame_count: 0,
        first_sequence: None,
        last_sequence: None,
        final_checksum: None,
        integrity_status: crate::runtime::NativeAuditIntegrityStatus::Open,
        created_at: now,
        closed_at: None,
        manifest_relative_path: String::new(),
        frames_relative_path: String::new(),
        raw_content_trusted: true,
    }
}

fn classify_payload(
    provider: DirectProvider,
    event: &ProviderEvent,
) -> Result<TypedProviderEvent, NativeAuditError> {
    let Some(payload) = event.payload_json.as_ref() else {
        let text = String::from_utf8_lossy(&event.payload).trim().to_string();
        if text.is_empty() {
            return Ok(TypedProviderEvent::Unknown {
                event_type: "empty".to_string(),
                payload: Value::Null,
            });
        }
        return Ok(TypedProviderEvent::Message {
            role: AgentRuntimeMessageRole::Assistant,
            content: text,
            final_output: false,
        });
    };

    let object = payload.as_object();
    let event_type = object
        .and_then(|map| map.get("type").or_else(|| map.get("method")))
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_ascii_lowercase();
    let value = |keys: &[&str]| -> Option<&Value> {
        object.and_then(|map| keys.iter().find_map(|key| map.get(*key)))
    };
    let text = || {
        value(&["text", "content", "message", "delta", "output"])
            .and_then(Value::as_str)
            .map(str::to_owned)
    };

    match event_type.as_str() {
        "init" | "initialize" | "session" | "session_started" | "thread_started"
        | "session_observed" => value(&["session_id", "sessionId", "thread_id", "threadId"])
            .and_then(Value::as_str)
            .map(|id| TypedProviderEvent::SessionObserved(id.to_string()))
            .ok_or_else(|| NativeAuditError::MalformedFrame(event.sequence)),
        "thinking" | "reasoning" | "thought" => {
            Ok(TypedProviderEvent::Thinking(text().unwrap_or_default()))
        }
        "assistant" | "message" | "text" | "content" | "delta" | "assistant_message"
        | "text_delta" => Ok(TypedProviderEvent::Message {
            role: AgentRuntimeMessageRole::Assistant,
            content: text().unwrap_or_default(),
            final_output: value(&["final", "is_final", "done"])
                .and_then(Value::as_bool)
                .unwrap_or(false),
        }),
        "user" | "user_message" => Ok(TypedProviderEvent::Message {
            role: AgentRuntimeMessageRole::User,
            content: text().unwrap_or_default(),
            final_output: false,
        }),
        "tool_call" | "tool_use" | "function_call" | "tool_start" => {
            Ok(TypedProviderEvent::ToolCall {
                id: value(&["id", "call_id", "tool_call_id"])
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                name: value(&["name", "tool_name", "tool"])
                    .and_then(Value::as_str)
                    .unwrap_or("unknown_tool")
                    .to_string(),
                status: if value(&["approval_required", "requires_approval"])
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    AgentRuntimeToolStatus::WaitingApproval
                } else {
                    AgentRuntimeToolStatus::Running
                },
                arguments: value(&["arguments", "input", "args"]).cloned(),
                result: None,
            })
        }
        "tool_result" | "tool_end" | "function_result" => Ok(TypedProviderEvent::ToolCall {
            id: value(&["id", "call_id", "tool_call_id"])
                .and_then(Value::as_str)
                .map(str::to_owned),
            name: value(&["name", "tool_name", "tool"])
                .and_then(Value::as_str)
                .unwrap_or("unknown_tool")
                .to_string(),
            status: if value(&["error", "failed"])
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                AgentRuntimeToolStatus::Failed
            } else {
                AgentRuntimeToolStatus::Succeeded
            },
            arguments: None,
            result: value(&["result", "output", "content"]).cloned(),
        }),
        "approval_requested" | "permission_request" | "tool_approval" => {
            Ok(TypedProviderEvent::ApprovalRequested {
                id: value(&["approval_id", "id", "request_id"])
                    .and_then(Value::as_str)
                    .unwrap_or("unknown-approval")
                    .to_string(),
                tool_call_id: value(&["tool_call_id", "call_id"])
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                tool_name: value(&["tool_name", "name", "tool"])
                    .and_then(Value::as_str)
                    .unwrap_or("unknown_tool")
                    .to_string(),
            })
        }
        "approval_resolved" | "permission_response" | "tool_approval_response" => {
            Ok(TypedProviderEvent::ApprovalResolved {
                id: value(&["approval_id", "id", "request_id"])
                    .and_then(Value::as_str)
                    .unwrap_or("unknown-approval")
                    .to_string(),
                approved: value(&["approved", "allow"])
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                reason: value(&["reason", "message"])
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            })
        }
        "input_requested" | "input_request" | "question" | "ask_user" => {
            Ok(TypedProviderEvent::InputRequested {
                id: value(&["input_id", "id", "request_id"])
                    .and_then(Value::as_str)
                    .unwrap_or("unknown-input")
                    .to_string(),
                prompt: value(&["prompt", "question", "message"])
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            })
        }
        "input_resolved" | "question_answered" | "answer" => {
            Ok(TypedProviderEvent::InputResolved {
                id: value(&["input_id", "id", "request_id"])
                    .and_then(Value::as_str)
                    .unwrap_or("unknown-input")
                    .to_string(),
                answered: value(&["answered", "ok"])
                    .and_then(Value::as_bool)
                    .unwrap_or(true),
            })
        }
        "usage" | "token_usage" | "tokens" => Ok(TypedProviderEvent::TokenUsage {
            input_tokens: value(&["input_tokens", "prompt_tokens"])
                .and_then(Value::as_u64)
                .unwrap_or(0),
            output_tokens: value(&["output_tokens", "completion_tokens"])
                .and_then(Value::as_u64)
                .unwrap_or(0),
            cached_input_tokens: value(&["cached_input_tokens", "cache_read_tokens"])
                .and_then(Value::as_u64),
        }),
        "result" | "completed" | "done" | "success" => {
            Ok(TypedProviderEvent::Lifecycle(AgentRunStatus::Succeeded))
        }
        "cancelled" | "canceled" | "abort" => {
            Ok(TypedProviderEvent::Lifecycle(AgentRunStatus::Cancelled))
        }
        "error" | "failure" | "failed" | "protocol_error" => Ok(TypedProviderEvent::Error(
            AgentRuntimeError::new(
                if event_type.contains("protocol") {
                    AgentRuntimeErrorKind::ProtocolFailed
                } else {
                    AgentRuntimeErrorKind::Unknown
                },
                value(&["message", "error", "reason"])
                    .and_then(Value::as_str)
                    .unwrap_or("provider error"),
            )
            .with_provider(Some(provider.id())),
        )),
        "eof" | "exit" | "terminal" => Err(NativeAuditError::MalformedFrame(event.sequence)),
        _ => Ok(TypedProviderEvent::Unknown {
            event_type,
            payload: payload.clone(),
        }),
    }
}

fn map_typed_event(
    provider: DirectProvider,
    event: &DecodedProviderEvent,
    manifest: &NativeAuditManifest,
) -> Result<Vec<AgentEvent>, NativeAuditError> {
    let payload = match &event.typed {
        TypedProviderEvent::Lifecycle(status) => {
            AgentEventPayload::LifecycleChanged { status: *status }
        }
        TypedProviderEvent::SessionObserved(session_id) => AgentEventPayload::SessionObserved {
            provider_session: ProviderSessionReference {
                schema_version: crate::runtime::PROVIDER_SESSION_REFERENCE_SCHEMA_VERSION,
                provider_id: provider.id().to_string(),
                runtime_profile_id: manifest.runtime_profile_id.clone(),
                provider_session_id: session_id.clone(),
                observed_at: event.raw.timestamp,
                metadata: Some(serde_json::json!({ "source": "native_frame" })),
            },
        },
        TypedProviderEvent::Message {
            role,
            content,
            final_output,
        } => AgentEventPayload::Message {
            message: crate::runtime::CanonicalMessage {
                message_id: event_id(manifest.run_attempt_id, event.raw.sequence),
                role: *role,
                content: content.clone(),
            },
            final_output: *final_output,
        },
        TypedProviderEvent::Thinking(content) => AgentEventPayload::Thinking {
            content: content.clone(),
        },
        TypedProviderEvent::ToolCall {
            id,
            name,
            status,
            arguments,
            result,
        } => AgentEventPayload::ToolCall {
            tool_call_id: id.clone(),
            tool_name: name.clone(),
            status: *status,
            arguments: arguments.clone(),
            result: result.clone(),
        },
        TypedProviderEvent::ApprovalRequested {
            id,
            tool_call_id,
            tool_name,
        } => AgentEventPayload::ApprovalRequested {
            approval_id: id.clone(),
            tool_call_id: tool_call_id.clone(),
            tool_name: tool_name.clone(),
        },
        TypedProviderEvent::ApprovalResolved {
            id,
            approved,
            reason,
        } => AgentEventPayload::ApprovalResolved {
            approval_id: id.clone(),
            approved: *approved,
            reason: reason.clone(),
        },
        TypedProviderEvent::InputRequested { id, prompt } => AgentEventPayload::InputRequested {
            input_id: id.clone(),
            prompt: prompt.clone(),
        },
        TypedProviderEvent::InputResolved { id, answered } => AgentEventPayload::InputResolved {
            input_id: id.clone(),
            answered: *answered,
        },
        TypedProviderEvent::TokenUsage {
            input_tokens,
            output_tokens,
            cached_input_tokens,
        } => AgentEventPayload::TokenUsage {
            input_tokens: *input_tokens,
            output_tokens: *output_tokens,
            cached_input_tokens: *cached_input_tokens,
        },
        TypedProviderEvent::Error(error) => AgentEventPayload::Error {
            error: error.clone(),
        },
        TypedProviderEvent::Unknown {
            event_type,
            payload,
        } => AgentEventPayload::ProviderExtension {
            provider_namespace: provider.id().to_string(),
            provider_event: event_type.clone(),
            payload: payload.clone(),
        },
    };
    Ok(vec![AgentEventEnvelope {
        schema_version: AGENT_EVENT_SCHEMA_VERSION,
        payload_version: AGENT_EVENT_PAYLOAD_VERSION,
        event_id: event_id(manifest.run_attempt_id, event.raw.sequence),
        session_id: manifest.session_id,
        agent_run_id: manifest.agent_run_id,
        turn_id: manifest.turn_id,
        run_attempt_id: manifest.run_attempt_id,
        run_attempt_number: manifest.run_attempt_number,
        sequence: event.raw.sequence,
        correlation_id: event.raw.correlation_id,
        orchestration_run_id: None,
        orchestration_node_execution_id: None,
        timestamp: event.raw.timestamp,
        native_refs: vec![event.raw.native_ref.clone()],
        payload,
    }])
}

fn event_id(run_attempt_id: Uuid, sequence: u64) -> Uuid {
    let mut hasher = Sha256::new();
    hasher.update(run_attempt_id.as_bytes());
    hasher.update(sequence.to_be_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&hasher.finalize()[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}

/// Build the request written to Oh My Pi's stdio RPC transport.
pub fn oh_my_pi_rpc_request(
    method: &str,
    id: u64,
    prompt: Option<&str>,
    session_id: Option<&str>,
) -> Value {
    let mut params = Map::new();
    if let Some(prompt) = prompt {
        params.insert("prompt".to_string(), Value::String(prompt.to_string()));
    }
    if let Some(session_id) = session_id {
        params.insert(
            "session_id".to_string(),
            Value::String(session_id.to_string()),
        );
    }
    serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

/// Serialize one NDJSON request without appending a second frame or accepting
/// an embedded SDK.  Callers write the returned bytes directly to `omp` stdin.
pub fn encode_stdio_rpc(request: &Value) -> Result<Vec<u8>, serde_json::Error> {
    let mut bytes = serde_json::to_vec(request)?;
    bytes.push(b'\n');
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use chrono::DateTime;

    use super::*;
    use crate::{
        approvals::NoopExecutorApprovalService,
        env::RepoContext,
        executors::BaseCodingAgent,
        runtime::{NativeAuditChannel, PROVIDER_SESSION_REFERENCE_SCHEMA_VERSION},
    };

    fn frame(provider: DirectProvider, payload: Value) -> NativeAuditFrame {
        NativeAuditFrame::from_bytes(
            1,
            DateTime::from_timestamp(1_700_000_000, 0).unwrap(),
            crate::runtime::NativeAuditDirection::Output,
            NativeAuditChannel::Stdout,
            "application/json",
            Uuid::from_u128(10),
            serde_json::to_string(&payload).unwrap().as_bytes(),
            Some(serde_json::json!({ "provider": provider.id() })),
        )
    }

    fn launch_env() -> ExecutionEnv {
        ExecutionEnv::new(
            RepoContext::new(".".into(), Vec::new()),
            false,
            String::new(),
        )
    }

    fn provider_session(
        provider: DirectProvider,
        config: &ExecutorConfig,
    ) -> ProviderSessionReference {
        ProviderSessionReference {
            schema_version: PROVIDER_SESSION_REFERENCE_SCHEMA_VERSION,
            provider_id: provider.id().to_string(),
            runtime_profile_id: config.profile_id().cache_key(),
            provider_session_id: "native-session".to_string(),
            observed_at: Utc::now(),
            metadata: None,
        }
    }

    fn validate_launch(
        provider: DirectProvider,
        config: &ExecutorConfig,
        intent: DirectIntent,
        session: Option<&ProviderSessionReference>,
        reset_to_message_id: Option<&str>,
    ) -> Result<(), ExecutorError> {
        let env = launch_env();
        validate_direct_launch(&DirectProviderLaunchRequest {
            provider,
            executor_config: config,
            intent,
            prompt: "prompt",
            provider_session: session,
            reset_to_message_id,
            selected_skills: &[],
            approvals: Arc::new(NoopExecutorApprovalService),
            current_dir: Path::new("."),
            env: &env,
        })
    }

    #[test]
    fn all_four_versions_are_frozen_and_distinct() {
        let versions = DirectProvider::ALL.map(DirectProvider::versions);
        assert_eq!(versions[1].runtime, Some("0.144.1"));
        assert_eq!(versions[1].protocol, Some("rust-v0.144.1"));
        assert_eq!(versions[3].executable, "omp");
        assert!(
            versions
                .windows(2)
                .all(|pair| pair[0].adapter != pair[1].adapter)
        );
    }

    #[test]
    fn all_four_profile_identities_map_to_their_direct_provider() {
        let mappings = [
            (BaseCodingAgent::Gemini, DirectProvider::Gemini),
            (BaseCodingAgent::Codex, DirectProvider::Codex),
            (BaseCodingAgent::ClaudeCode, DirectProvider::ClaudeCode),
            (BaseCodingAgent::OhMyPi, DirectProvider::OhMyPi),
        ];

        for (agent, provider) in mappings {
            assert_eq!(DirectProvider::from_base_agent(agent), Some(provider));
            let config = ExecutorConfig::new(agent);
            assert!(validate_launch(provider, &config, DirectIntent::Initial, None, None).is_ok());
        }
    }

    #[test]
    fn profile_provider_mismatch_is_rejected_before_spawn() {
        let error = validate_launch(
            DirectProvider::Gemini,
            &ExecutorConfig::new(BaseCodingAgent::Codex),
            DirectIntent::Initial,
            None,
            None,
        )
        .expect_err("mismatched profile must not launch");

        assert!(matches!(error, ExecutorError::UnknownExecutorType(_)));
    }

    #[test]
    fn follow_up_requires_a_matching_non_empty_provider_session() {
        let config = ExecutorConfig::new(BaseCodingAgent::Codex);
        let error = validate_launch(
            DirectProvider::Codex,
            &config,
            DirectIntent::FollowUp,
            None,
            None,
        )
        .expect_err("follow-up without a session must not launch");
        assert!(matches!(error, ExecutorError::FollowUpNotSupported(_)));

        let mut session = provider_session(DirectProvider::Codex, &config);
        session.runtime_profile_id = "CODEX:OTHER".to_string();
        let error = validate_launch(
            DirectProvider::Codex,
            &config,
            DirectIntent::FollowUp,
            Some(&session),
            None,
        )
        .expect_err("session from another profile must not launch");
        assert!(matches!(error, ExecutorError::FollowUpNotSupported(_)));
    }

    #[test]
    fn initial_launch_rejects_an_attached_provider_session() {
        let config = ExecutorConfig::new(BaseCodingAgent::Gemini);
        let session = provider_session(DirectProvider::Gemini, &config);

        let error = validate_launch(
            DirectProvider::Gemini,
            &config,
            DirectIntent::Initial,
            Some(&session),
            None,
        )
        .expect_err("initial launch must not accidentally resume");

        assert!(matches!(error, ExecutorError::FollowUpNotSupported(_)));
    }

    #[test]
    fn reset_is_only_allowed_for_claude_follow_up_or_resume() {
        for provider in [
            DirectProvider::Gemini,
            DirectProvider::Codex,
            DirectProvider::OhMyPi,
        ] {
            let agent = match provider {
                DirectProvider::Gemini => BaseCodingAgent::Gemini,
                DirectProvider::Codex => BaseCodingAgent::Codex,
                DirectProvider::OhMyPi => BaseCodingAgent::OhMyPi,
                DirectProvider::ClaudeCode => unreachable!(),
            };
            let config = ExecutorConfig::new(agent);
            let session = provider_session(provider, &config);
            let error = validate_launch(
                provider,
                &config,
                DirectIntent::FollowUp,
                Some(&session),
                Some("message-id"),
            )
            .expect_err("unsupported reset must not silently downgrade");
            assert!(matches!(
                error,
                ExecutorError::ResetToMessageNotSupported(_)
            ));
        }

        let config = ExecutorConfig::new(BaseCodingAgent::ClaudeCode);
        let session = provider_session(DirectProvider::ClaudeCode, &config);
        assert!(
            validate_launch(
                DirectProvider::ClaudeCode,
                &config,
                DirectIntent::Resume,
                Some(&session),
                Some("message-id"),
            )
            .is_ok()
        );
    }

    #[test]
    fn unknown_and_terminal_frames_fail_closed() {
        let unknown = DirectProvider::Gemini
            .decode_native_frame(&frame(
                DirectProvider::Gemini,
                serde_json::json!({"type":"future_event"}),
            ))
            .unwrap();
        assert!(matches!(unknown.typed, TypedProviderEvent::Unknown { .. }));
        assert!(
            DirectProvider::Gemini
                .decode_native_frame(&frame(
                    DirectProvider::Gemini,
                    serde_json::json!({"type":"eof"})
                ))
                .is_err()
        );
    }

    #[test]
    fn maps_approval_and_waiting_input_to_canonical_events() {
        let manifest = NativeAuditManifest {
            audit_schema_version: crate::runtime::NATIVE_AUDIT_SCHEMA_VERSION,
            session_id: Uuid::from_u128(1),
            agent_run_id: Uuid::from_u128(2),
            turn_id: Uuid::from_u128(3),
            run_attempt_id: Uuid::from_u128(4),
            run_attempt_number: 1,
            provider_id: "gemini".to_string(),
            runtime_profile_id: "default".to_string(),
            workspace_path: ".".to_string(),
            runtime_version: None,
            protocol_version: Some("acp-0.8".to_string()),
            adapter_version: "gemini-adapter-v1".to_string(),
            mapper_version: "gemini-mapper-v1".to_string(),
            frame_count: 1,
            first_sequence: Some(1),
            last_sequence: Some(1),
            final_checksum: None,
            integrity_status: crate::runtime::NativeAuditIntegrityStatus::Complete,
            created_at: Utc::now(),
            closed_at: None,
            manifest_relative_path: "manifest.json".to_string(),
            frames_relative_path: "frames.jsonl".to_string(),
            raw_content_trusted: true,
        };
        let event = DirectProvider::Gemini
            .decode_native_frame(&frame(
                DirectProvider::Gemini,
                serde_json::json!({"type":"approval_requested","approval_id":"a1","tool_name":"shell"}),
            ))
            .unwrap();
        let mapped = DirectProvider::Gemini
            .map_provider_event(&event, &manifest)
            .unwrap();
        assert!(matches!(
            mapped[0].payload,
            AgentEventPayload::ApprovalRequested { .. }
        ));
    }

    #[test]
    fn omp_rpc_is_ndjson_and_external() {
        let request = oh_my_pi_rpc_request("session/start", 1, Some("hello"), None);
        let bytes = encode_stdio_rpc(&request).unwrap();
        assert_eq!(bytes.last(), Some(&b'\n'));
        assert!(String::from_utf8(bytes).unwrap().contains("session/start"));
        assert_eq!(DirectProvider::OhMyPi.versions().executable, "omp");
    }

    #[test]
    fn controls_are_provider_native_and_fail_closed_on_unknown_capability() {
        let snapshot = DirectProvider::Gemini.capabilities("default");
        let bytes = encode_control(
            DirectProvider::Gemini,
            &snapshot,
            DirectControl::Approve {
                request_id: "a1".to_string(),
                approved: true,
                reason: None,
            },
        )
        .unwrap();
        assert!(
            String::from_utf8(bytes)
                .unwrap()
                .contains("request_permission/response")
        );

        let mut unknown = DirectProvider::Gemini.capabilities("default");
        unknown
            .capabilities
            .retain(|entry| entry.capability != crate::runtime::AgentCapability::Steering);
        let error = encode_control(
            DirectProvider::Gemini,
            &unknown,
            DirectControl::Steer {
                text: "stop".to_string(),
            },
        )
        .expect_err("missing steering capability must not silently fall back");
        assert!(matches!(
            error,
            DirectControlError::Capability(CapabilityGateError::Unresolved { .. })
        ));
    }

    #[test]
    fn all_provider_replays_use_the_same_decoder_mapper_reducer_path() {
        for provider in DirectProvider::ALL {
            let root = tempfile::tempdir().unwrap();
            let ids = [
                Uuid::new_v4(),
                Uuid::new_v4(),
                Uuid::new_v4(),
                Uuid::new_v4(),
            ];
            let versions = provider.versions();
            let mut writer = crate::runtime::NativeAuditWriter::create_in(
                root.path(),
                crate::runtime::NativeAuditMetadata {
                    session_id: ids[0],
                    agent_run_id: ids[1],
                    turn_id: ids[2],
                    run_attempt_id: ids[3],
                    run_attempt_number: 1,
                    provider_id: provider.id().to_string(),
                    runtime_profile_id: "default".to_string(),
                    workspace_path: root.path().display().to_string(),
                    runtime_version: versions.runtime.map(str::to_owned),
                    protocol_version: versions.protocol.map(str::to_owned),
                    adapter_version: versions.adapter.to_string(),
                    mapper_version: versions.mapper.to_string(),
                    created_at: Utc::now(),
                },
            )
            .unwrap();
            for payload in [
                serde_json::json!({"type":"session_started","session_id":"native-1"}),
                serde_json::json!({"type":"message","content":"done","final":true}),
                serde_json::json!({"type":"result"}),
            ] {
                writer
                    .append_native_output(
                        NativeAuditChannel::Stdout,
                        "application/json",
                        ids[0],
                        serde_json::to_string(&payload).unwrap().as_bytes(),
                    )
                    .unwrap();
            }
            let manifest = writer.close().unwrap();
            let directory = root
                .path()
                .join(&manifest.manifest_relative_path)
                .parent()
                .unwrap()
                .to_path_buf();
            let bundle = crate::runtime::AuditBundle::read(&directory).unwrap();
            let first = bundle.replay(&provider.mapper()).unwrap();
            let second = bundle.replay(&provider.mapper()).unwrap();
            assert_eq!(first.provider_events, second.provider_events);
            assert_eq!(first.agent_events, second.agent_events);
            assert_eq!(first.state, second.state);
            assert_eq!(first.state.status, AgentRunStatus::Succeeded);
            assert_eq!(first.state.last_event_sequence, 3);
        }
    }

    #[test]
    fn checked_in_native_fixtures_replay_for_every_v1_provider() {
        for provider in DirectProvider::ALL {
            let directory = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("fixtures/native-audit")
                .join(provider.id());
            let bundle = crate::runtime::AuditBundle::read(&directory)
                .unwrap_or_else(|error| panic!("failed to read {} fixture: {error}", provider.id()));
            let replay = bundle
                .replay_fixture(&provider.mapper())
                .unwrap_or_else(|error| panic!("failed to replay {} fixture: {error}", provider.id()));

            assert_eq!(bundle.manifest().provider_id, provider.id());
            assert_eq!(replay.provider_events.len(), 3);
            assert_eq!(replay.agent_events.len(), 3);
            assert_eq!(replay.state.status, AgentRunStatus::Succeeded);
            assert_eq!(replay.state.last_event_sequence, 3);
        }
    }
}
