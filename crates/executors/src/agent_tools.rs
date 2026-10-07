//! Native MCP server and Skill management for direct agent providers.
//!
//! Provider files remain the source of truth. This module supplies a common
//! discovery and mutation boundary while keeping paths, encodings, and toggle
//! behavior provider-owned.

use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use jsonc_parser::ParseOptions;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;
use walkdir::WalkDir;

use crate::{
    executors::provider_adapter::DirectProvider,
    mcp_config::{direct_provider_mcp_config, update_jsonc_content},
};

#[path = "native_assets.rs"]
pub(crate) mod native_assets;

const DISABLED_STORE_VERSION: u32 = 1;
const MAX_SKILL_FILES: usize = 256;
const MAX_SKILL_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AgentToolProvider {
    Codex,
    ClaudeCode,
    Gemini,
    OhMyPi,
    Opencode,
    DeepseekHarness,
}

impl AgentToolProvider {
    pub const ALL: [Self; 6] = [
        Self::Codex,
        Self::ClaudeCode,
        Self::Gemini,
        Self::OhMyPi,
        Self::Opencode,
        Self::DeepseekHarness,
    ];

    pub const fn id(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::ClaudeCode => "claude_code",
            Self::Gemini => "gemini",
            Self::OhMyPi => "oh_my_pi",
            Self::Opencode => "opencode",
            Self::DeepseekHarness => "deepseek_harness",
        }
    }

    const fn executable(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::ClaudeCode => "claude",
            Self::Gemini => "gemini",
            Self::OhMyPi => "omp",
            Self::Opencode => "opencode",
            Self::DeepseekHarness => "dsh",
        }
    }
}

impl From<DirectProvider> for AgentToolProvider {
    fn from(value: DirectProvider) -> Self {
        match value {
            DirectProvider::Codex => Self::Codex,
            DirectProvider::ClaudeCode => Self::ClaudeCode,
            DirectProvider::Gemini => Self::Gemini,
            DirectProvider::OhMyPi => Self::OhMyPi,
            DirectProvider::Opencode => Self::Opencode,
            DirectProvider::DeepseekHarness => Self::DeepseekHarness,
        }
    }
}

impl From<AgentToolProvider> for DirectProvider {
    fn from(value: AgentToolProvider) -> Self {
        match value {
            AgentToolProvider::Codex => Self::Codex,
            AgentToolProvider::ClaudeCode => Self::ClaudeCode,
            AgentToolProvider::Gemini => Self::Gemini,
            AgentToolProvider::OhMyPi => Self::OhMyPi,
            AgentToolProvider::Opencode => Self::Opencode,
            AgentToolProvider::DeepseekHarness => Self::DeepseekHarness,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AgentToolKind {
    McpServer,
    Skill,
}

impl AgentToolKind {
    const fn store_name(self) -> &'static str {
        match self {
            Self::McpServer => "mcp",
            Self::Skill => "skill",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AgentToolScope {
    User,
    Project,
}

impl AgentToolScope {
    const fn store_name(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Project => "project",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AgentToolState {
    NotInstalled,
    Enabled,
    Disabled,
    Error,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentToolCapabilities {
    pub editable: bool,
    pub removable: bool,
    pub toggleable: bool,
    pub exportable: bool,
    pub installable: bool,
}

impl Default for AgentToolCapabilities {
    fn default() -> Self {
        Self {
            editable: true,
            removable: true,
            toggleable: true,
            exportable: true,
            installable: true,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum McpTransport {
    Stdio,
    Http,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpServerDefinition {
    pub transport: McpTransport,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    // Lossless source-provider data. It is preserved for same-provider edits
    // and copy audit output, but never emitted blindly to another provider.
    #[serde(default)]
    pub source_metadata: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SkillFile {
    pub path: String,
    // Base64-encoded bytes. Skills may contain images, archives, and other
    // non-UTF-8 assets, so the portable bundle must not assume text.
    pub content_base64: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SkillDefinition {
    #[serde(default)]
    pub description: Option<String>,
    pub files: Vec<SkillFile>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum AgentToolDefinition {
    McpServer(McpServerDefinition),
    Skill(SkillDefinition),
}

impl AgentToolDefinition {
    pub const fn kind(&self) -> AgentToolKind {
        match self {
            Self::McpServer(_) => AgentToolKind::McpServer,
            Self::Skill(_) => AgentToolKind::Skill,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentTool {
    pub provider: AgentToolProvider,
    pub scope: AgentToolScope,
    pub kind: AgentToolKind,
    pub name: String,
    pub native_path: String,
    pub state: AgentToolState,
    pub capabilities: AgentToolCapabilities,
    pub revision: String,
    pub definition: AgentToolDefinition,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentToolProviderError {
    pub provider: AgentToolProvider,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentToolProviderInventory {
    pub provider: AgentToolProvider,
    pub installed: bool,
    pub items: Vec<AgentTool>,
    pub limitations: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AgentToolInventory {
    pub providers: Vec<AgentToolProviderInventory>,
    pub errors: Vec<AgentToolProviderError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentToolLocator {
    pub provider: AgentToolProvider,
    pub scope: AgentToolScope,
    pub kind: AgentToolKind,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum SensitiveStringWrite {
    Preserve,
    Replace { value: String },
    Clear,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum SensitiveStringListWrite {
    Preserve,
    Replace { value: Vec<String> },
    Clear,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum SensitiveStringMapWrite {
    Preserve,
    Replace { value: BTreeMap<String, String> },
    Clear,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct McpServerWriteDefinition {
    pub transport: McpTransport,
    pub command: SensitiveStringWrite,
    pub args: SensitiveStringListWrite,
    pub cwd: SensitiveStringWrite,
    pub url: SensitiveStringWrite,
    pub env: SensitiveStringMapWrite,
    pub headers: SensitiveStringMapWrite,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum SkillWriteDefinition {
    Preserve,
    Replace { value: SkillDefinition },
    ReplaceContract { value: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum AgentToolWriteDefinition {
    McpServer(McpServerWriteDefinition),
    Skill(SkillWriteDefinition),
}

impl AgentToolWriteDefinition {
    pub const fn kind(&self) -> AgentToolKind {
        match self {
            Self::McpServer(_) => AgentToolKind::McpServer,
            Self::Skill(_) => AgentToolKind::Skill,
        }
    }

    fn resolve(
        self,
        current: Option<&AgentToolDefinition>,
    ) -> Result<AgentToolDefinition, AgentToolError> {
        match self {
            Self::Skill(definition) => {
                let current = current.and_then(|definition| match definition {
                    AgentToolDefinition::Skill(definition) => Some(definition),
                    AgentToolDefinition::McpServer(_) => None,
                });
                Ok(AgentToolDefinition::Skill(resolve_skill_definition(
                    definition, current,
                )?))
            }
            Self::McpServer(definition) => {
                let current = current.and_then(|definition| match definition {
                    AgentToolDefinition::McpServer(definition) => Some(definition),
                    AgentToolDefinition::Skill(_) => None,
                });
                Ok(AgentToolDefinition::McpServer(McpServerDefinition {
                    transport: definition.transport,
                    command: resolve_sensitive_optional_string(
                        definition.command,
                        current.map(|item| item.command.as_deref()),
                    )?,
                    args: resolve_sensitive_list(
                        definition.args,
                        current.map(|item| item.args.as_slice()),
                    )?,
                    cwd: resolve_sensitive_optional_string(
                        definition.cwd,
                        current.map(|item| item.cwd.as_deref()),
                    )?,
                    env: resolve_sensitive_map(definition.env, current.map(|item| &item.env))?,
                    url: resolve_sensitive_optional_string(
                        definition.url,
                        current.map(|item| item.url.as_deref()),
                    )?,
                    headers: resolve_sensitive_map(
                        definition.headers,
                        current.map(|item| &item.headers),
                    )?,
                    // Provider-only native state is never accepted from a
                    // browser request. Same-provider edits preserve it inside
                    // the Adapter; new items start without extensions.
                    source_metadata: current
                        .map(|item| item.source_metadata.clone())
                        .unwrap_or(Value::Null),
                }))
            }
        }
    }
}

fn preserve_requires_existing<T>(current: Option<T>) -> Result<T, AgentToolError> {
    current.ok_or_else(|| {
        AgentToolError::InvalidRequest(
            "new tool definitions must explicitly replace or clear write-only fields".into(),
        )
    })
}

fn resolve_sensitive_optional_string(
    write: SensitiveStringWrite,
    current: Option<Option<&str>>,
) -> Result<Option<String>, AgentToolError> {
    match write {
        SensitiveStringWrite::Preserve => {
            preserve_requires_existing(current.map(|value| value.map(str::to_owned)))
        }
        SensitiveStringWrite::Replace { value } => Ok(Some(value)),
        SensitiveStringWrite::Clear => Ok(None),
    }
}

fn resolve_sensitive_list(
    write: SensitiveStringListWrite,
    current: Option<&[String]>,
) -> Result<Vec<String>, AgentToolError> {
    match write {
        SensitiveStringListWrite::Preserve => {
            preserve_requires_existing(current.map(<[String]>::to_vec))
        }
        SensitiveStringListWrite::Replace { value } => Ok(value),
        SensitiveStringListWrite::Clear => Ok(Vec::new()),
    }
}

fn resolve_sensitive_map(
    write: SensitiveStringMapWrite,
    current: Option<&BTreeMap<String, String>>,
) -> Result<BTreeMap<String, String>, AgentToolError> {
    match write {
        SensitiveStringMapWrite::Preserve => current.cloned().ok_or_else(|| {
            AgentToolError::InvalidRequest(
                "new tool definitions must explicitly replace or clear write-only fields".into(),
            )
        }),
        SensitiveStringMapWrite::Replace { value } => Ok(value),
        SensitiveStringMapWrite::Clear => Ok(BTreeMap::new()),
    }
}

fn resolve_skill_definition(
    write: SkillWriteDefinition,
    current: Option<&SkillDefinition>,
) -> Result<SkillDefinition, AgentToolError> {
    match write {
        SkillWriteDefinition::Preserve => preserve_requires_existing(current.cloned()),
        SkillWriteDefinition::Replace { value } => Ok(value),
        SkillWriteDefinition::ReplaceContract { value } => {
            let mut definition = current.cloned().unwrap_or(SkillDefinition {
                description: None,
                files: Vec::new(),
            });
            definition.files.retain(|file| file.path != "SKILL.md");
            definition.files.insert(
                0,
                SkillFile {
                    path: "SKILL.md".into(),
                    content_base64: BASE64.encode(value.as_bytes()),
                },
            );
            Ok(definition)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
pub struct McpServerDefinitionSummary {
    pub transport: McpTransport,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command_display: Option<String>,
    pub command_configured: bool,
    pub args_count: usize,
    pub cwd_configured: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url_display: Option<String>,
    pub url_configured: bool,
    pub env_count: usize,
    pub header_count: usize,
    pub has_provider_extensions: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
pub struct SkillDefinitionSummary {
    pub contract_configured: bool,
    pub file_count: usize,
    pub has_assets: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum AgentToolDefinitionSummary {
    McpServer(McpServerDefinitionSummary),
    Skill(SkillDefinitionSummary),
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
pub struct AgentToolView {
    pub installation_id: String,
    pub provider: AgentToolProvider,
    pub scope: AgentToolScope,
    pub kind: AgentToolKind,
    pub name: String,
    pub state: AgentToolState,
    pub capabilities: AgentToolCapabilities,
    pub revision: String,
    pub definition: AgentToolDefinitionSummary,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl From<AgentTool> for AgentToolView {
    fn from(item: AgentTool) -> Self {
        let installation_id = tool_installation_id(&item);
        let definition = match item.definition {
            AgentToolDefinition::McpServer(definition) => {
                AgentToolDefinitionSummary::McpServer(McpServerDefinitionSummary {
                    transport: definition.transport,
                    command_display: definition.command.as_deref().and_then(safe_command_display),
                    command_configured: definition.command.is_some(),
                    args_count: definition.args.len(),
                    cwd_configured: definition.cwd.is_some(),
                    url_display: definition.url.as_deref().and_then(safe_url_display),
                    url_configured: definition.url.is_some(),
                    env_count: definition.env.len(),
                    header_count: definition.headers.len(),
                    has_provider_extensions: !definition.source_metadata.is_null(),
                })
            }
            AgentToolDefinition::Skill(definition) => {
                AgentToolDefinitionSummary::Skill(SkillDefinitionSummary {
                    contract_configured: definition
                        .files
                        .iter()
                        .any(|file| file.path == "SKILL.md"),
                    file_count: definition.files.len(),
                    has_assets: definition.files.iter().any(|file| file.path != "SKILL.md"),
                })
            }
        };
        Self {
            installation_id,
            provider: item.provider,
            scope: item.scope,
            kind: item.kind,
            name: item.name,
            state: item.state,
            capabilities: item.capabilities,
            revision: item.revision,
            definition,
            error: item.error,
        }
    }
}

fn tool_installation_id(item: &AgentTool) -> String {
    let mut hasher = Sha256::new();
    hasher.update(item.provider.id().as_bytes());
    hasher.update([0]);
    hasher.update(item.scope.store_name().as_bytes());
    hasher.update([0]);
    hasher.update(item.kind.store_name().as_bytes());
    hasher.update([0]);
    hasher.update(item.name.as_bytes());
    hasher.update([0]);
    hasher.update(item.native_path.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn safe_command_display(command: &str) -> Option<String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return None;
    }
    Path::new(trimmed)
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
}

fn safe_url_display(value: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(value).ok()?;
    let host = parsed.host_str()?;
    let mut display = format!("{}://{}", parsed.scheme(), host);
    if let Some(port) = parsed.port() {
        display.push(':');
        display.push_str(&port.to_string());
    }
    Some(display)
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
pub struct AgentToolProviderInventoryView {
    pub provider: AgentToolProvider,
    pub installed: bool,
    pub mcp_scopes: Vec<AgentToolScope>,
    pub skill_scopes: Vec<AgentToolScope>,
    pub items: Vec<AgentToolView>,
    #[serde(default)]
    pub limitations: Vec<String>,
    #[serde(default)]
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
pub struct AgentToolInventoryView {
    pub providers: Vec<AgentToolProviderInventoryView>,
    #[serde(default)]
    pub errors: Vec<AgentToolProviderError>,
}

impl From<AgentToolInventory> for AgentToolInventoryView {
    fn from(inventory: AgentToolInventory) -> Self {
        Self {
            providers: inventory
                .providers
                .into_iter()
                .map(|provider| AgentToolProviderInventoryView {
                    provider: provider.provider,
                    installed: provider.installed,
                    mcp_scopes: if provider.provider == AgentToolProvider::DeepseekHarness {
                        vec![AgentToolScope::User]
                    } else {
                        vec![AgentToolScope::User, AgentToolScope::Project]
                    },
                    skill_scopes: vec![AgentToolScope::User, AgentToolScope::Project],
                    items: provider
                        .items
                        .into_iter()
                        .map(AgentToolView::from)
                        .collect(),
                    limitations: provider.limitations,
                    errors: provider.errors,
                })
                .collect(),
            errors: inventory.errors,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct CreateAgentToolRequest {
    pub target: AgentToolLocator,
    pub definition: AgentToolWriteDefinition,
    #[serde(default)]
    pub replace: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expected_revision: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct UpdateAgentToolRequest {
    pub target: AgentToolLocator,
    pub expected_revision: String,
    pub definition: AgentToolWriteDefinition,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct RemoveAgentToolRequest {
    pub target: AgentToolLocator,
    pub expected_revision: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ToggleAgentToolRequest {
    pub target: AgentToolLocator,
    pub expected_revision: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct CopyAgentToolRequest {
    pub source: AgentToolLocator,
    pub expected_revision: String,
    pub target_provider: AgentToolProvider,
    pub target_scope: AgentToolScope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_project_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_name: Option<String>,
    #[serde(default)]
    pub replace: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_expected_revision: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
pub struct CopyAgentToolResponse {
    pub item: AgentToolView,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AgentToolErrorCode {
    InvalidRequest,
    InvalidConfiguration,
    NotFound,
    Collision,
    StaleRevision,
    Unsupported,
    UnsafePath,
    Io,
    VerificationFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentToolOperationError {
    pub code: AgentToolErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<AgentToolProvider>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Debug, Error)]
pub enum AgentToolError {
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("invalid native configuration: {0}")]
    InvalidConfiguration(String),
    #[error("agent tool not found: {0}")]
    NotFound(String),
    #[error("agent tool already exists: {0}")]
    Collision(String),
    #[error("native content changed since it was read")]
    StaleRevision,
    #[error("operation is unsupported: {0}")]
    Unsupported(String),
    #[error("unsafe path: {0}")]
    UnsafePath(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("write verification failed: {0}")]
    VerificationFailed(String),
}

impl AgentToolError {
    pub fn operation_error(
        &self,
        provider: Option<AgentToolProvider>,
        name: Option<String>,
    ) -> AgentToolOperationError {
        let code = match self {
            Self::InvalidRequest(_) => AgentToolErrorCode::InvalidRequest,
            Self::InvalidConfiguration(_) => AgentToolErrorCode::InvalidConfiguration,
            Self::NotFound(_) => AgentToolErrorCode::NotFound,
            Self::Collision(_) => AgentToolErrorCode::Collision,
            Self::StaleRevision => AgentToolErrorCode::StaleRevision,
            Self::Unsupported(_) => AgentToolErrorCode::Unsupported,
            Self::UnsafePath(_) => AgentToolErrorCode::UnsafePath,
            Self::Io(_) => AgentToolErrorCode::Io,
            Self::VerificationFailed(_) => AgentToolErrorCode::VerificationFailed,
        };
        AgentToolOperationError {
            code,
            message: self.to_string(),
            provider,
            name,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AgentToolService {
    home_dir: PathBuf,
    disabled_root: PathBuf,
}

struct ResolvedCreateAgentToolRequest {
    target: AgentToolLocator,
    definition: AgentToolDefinition,
    replace: bool,
    expected_revision: Option<String>,
}

struct ResolvedUpdateAgentToolRequest {
    target: AgentToolLocator,
    expected_revision: String,
    definition: AgentToolDefinition,
}

impl AgentToolService {
    pub fn new(home_dir: PathBuf, disabled_root: PathBuf) -> Self {
        Self {
            home_dir,
            disabled_root,
        }
    }

    pub fn from_system() -> Result<Self, AgentToolError> {
        let home_dir = dirs::home_dir().ok_or_else(|| {
            AgentToolError::InvalidRequest("could not determine the user home directory".into())
        })?;
        Ok(Self::new(
            home_dir,
            workspace_utils::assets::asset_dir().join("agent-tools/disabled/v1"),
        ))
    }

    pub fn manager(
        &self,
        provider: AgentToolProvider,
        project_path: Option<&Path>,
    ) -> ProviderToolManager {
        DirectProvider::from(provider).tool_manager(
            self.home_dir.clone(),
            project_path.map(Path::to_path_buf),
            self.disabled_root.clone(),
        )
    }

    pub fn discover(&self, project_path: Option<&Path>) -> AgentToolInventory {
        let mut providers = Vec::new();
        let mut errors = Vec::new();
        for provider in AgentToolProvider::ALL {
            match self.manager(provider, project_path).discover() {
                Ok(inventory) => providers.push(inventory),
                Err(error) => {
                    errors.push(AgentToolProviderError {
                        provider,
                        message: error.to_string(),
                    });
                    providers.push(AgentToolProviderInventory {
                        provider,
                        installed: false,
                        items: Vec::new(),
                        limitations: provider_limitations(provider),
                        errors: vec![error.to_string()],
                    });
                }
            }
        }
        AgentToolInventory { providers, errors }
    }

    pub fn create(&self, request: CreateAgentToolRequest) -> Result<AgentTool, AgentToolError> {
        validate_locator(&request.target)?;
        if request.target.kind != request.definition.kind() {
            return Err(AgentToolError::InvalidRequest(
                "locator kind does not match definition".into(),
            ));
        }
        let manager = self.manager_for_locator(&request.target);
        let current = if request.replace {
            match manager.find(&request.target) {
                Ok(current) => Some(current),
                Err(AgentToolError::NotFound(_)) => None,
                Err(error) => return Err(error),
            }
        } else {
            None
        };
        if let Some(current) = &current {
            let expected = request.expected_revision.as_deref().ok_or_else(|| {
                AgentToolError::InvalidRequest(
                    "replace requires the current target revision".into(),
                )
            })?;
            ensure_revision(&current.revision, expected)?;
        }
        let definition = request
            .definition
            .resolve(current.as_ref().map(|item| &item.definition))?;
        manager.create(ResolvedCreateAgentToolRequest {
            target: request.target,
            definition,
            replace: request.replace,
            expected_revision: request.expected_revision,
        })
    }

    pub fn update(&self, request: UpdateAgentToolRequest) -> Result<AgentTool, AgentToolError> {
        validate_locator(&request.target)?;
        if request.target.kind != request.definition.kind() {
            return Err(AgentToolError::InvalidRequest(
                "locator kind does not match definition".into(),
            ));
        }
        let manager = self.manager_for_locator(&request.target);
        let current = manager.find(&request.target)?;
        ensure_revision(&current.revision, &request.expected_revision)?;
        let definition = request.definition.resolve(Some(&current.definition))?;
        manager.update(ResolvedUpdateAgentToolRequest {
            target: request.target,
            expected_revision: request.expected_revision,
            definition,
        })
    }

    pub fn remove(&self, request: RemoveAgentToolRequest) -> Result<(), AgentToolError> {
        validate_locator(&request.target)?;
        self.manager_for_locator(&request.target).remove(request)
    }

    pub fn set_enabled(
        &self,
        request: ToggleAgentToolRequest,
    ) -> Result<AgentTool, AgentToolError> {
        validate_locator(&request.target)?;
        self.manager_for_locator(&request.target)
            .set_enabled(request)
    }

    pub fn copy(
        &self,
        request: CopyAgentToolRequest,
    ) -> Result<CopyAgentToolResponse, AgentToolError> {
        validate_locator(&request.source)?;
        let source_manager = self.manager_for_locator(&request.source);
        let source = source_manager.find(&request.source)?;
        ensure_revision(&source.revision, &request.expected_revision)?;
        if source.state != AgentToolState::Enabled {
            return Err(AgentToolError::Unsupported(
                "only enabled installations can be copied".into(),
            ));
        }

        let target_name = request
            .target_name
            .clone()
            .unwrap_or_else(|| source.name.clone());
        validate_name(&target_name)?;
        let source_metadata = match &source.definition {
            AgentToolDefinition::McpServer(definition) => definition.source_metadata.clone(),
            AgentToolDefinition::Skill(_) => Value::Null,
        };
        let mut definition = source.definition.clone();
        if source.provider != request.target_provider
            && let AgentToolDefinition::McpServer(mcp) = &mut definition
        {
            // Cross-provider installs only render the portable intersection.
            // Source-only data stays inside the source Adapter and never
            // enters the target definition or public copy response.
            mcp.source_metadata = Value::Null;
        }
        let target = AgentToolLocator {
            provider: request.target_provider,
            scope: request.target_scope,
            kind: source.kind,
            name: target_name,
            installation_id: None,
            native_path: None,
            project_path: request.target_project_path,
        };
        let item = self
            .manager_for_locator(&target)
            .create(ResolvedCreateAgentToolRequest {
                target,
                definition,
                replace: request.replace,
                expected_revision: request.target_expected_revision,
            })?;
        let warnings = if source.provider != request.target_provider && !source_metadata.is_null() {
            vec!["Provider-specific source fields were not copied to the target provider.".into()]
        } else {
            Vec::new()
        };
        Ok(CopyAgentToolResponse {
            item: item.into(),
            warnings,
        })
    }

    pub fn get(&self, locator: &AgentToolLocator) -> Result<AgentTool, AgentToolError> {
        validate_locator(locator)?;
        self.manager_for_locator(locator).find(locator)
    }

    fn manager_for_locator(&self, locator: &AgentToolLocator) -> ProviderToolManager {
        self.manager(
            locator.provider,
            locator.project_path.as_deref().map(Path::new),
        )
    }
}

#[derive(Debug, Clone)]
pub struct ProviderToolManager {
    provider: AgentToolProvider,
    home_dir: PathBuf,
    project_path: Option<PathBuf>,
    disabled_root: PathBuf,
}

impl ProviderToolManager {
    pub fn new(
        provider: AgentToolProvider,
        home_dir: PathBuf,
        project_path: Option<PathBuf>,
        disabled_root: PathBuf,
    ) -> Self {
        let project_path = project_path.map(|path| fs::canonicalize(&path).unwrap_or(path));
        Self {
            provider,
            home_dir,
            project_path,
            disabled_root,
        }
    }

    pub const fn provider(&self) -> AgentToolProvider {
        self.provider
    }

    pub fn is_installed(&self) -> Result<bool, AgentToolError> {
        Ok(self.provider_root().exists()
            || self
                .mcp_candidates(AgentToolScope::User)?
                .iter()
                .any(|path| path.exists())
            || workspace_utils::shell::resolve_executable_path_blocking(self.provider.executable())
                .is_some())
    }

    pub fn discover(&self) -> Result<AgentToolProviderInventory, AgentToolError> {
        let installed = self.is_installed()?;
        let mut items = Vec::new();
        let mut errors = Vec::new();
        for scope in [AgentToolScope::User, AgentToolScope::Project] {
            if scope == AgentToolScope::Project && self.project_path.is_none() {
                continue;
            }
            if !(self.provider == AgentToolProvider::DeepseekHarness
                && scope == AgentToolScope::Project)
                && let Err(error) = self.discover_mcp(scope, &mut items)
            {
                errors.push(format!("{} MCP: {error}", scope.store_name()));
            }
            if let Err(error) = self.discover_skills(scope, &mut items) {
                errors.push(format!("{} Skills: {error}", scope.store_name()));
            }
            if let Err(error) = self.discover_disabled(scope, &mut items) {
                errors.push(format!("{} disabled store: {error}", scope.store_name()));
            }
        }
        items.sort_by(|left, right| {
            (
                left.kind.store_name(),
                left.name.as_str(),
                left.native_path.as_str(),
            )
                .cmp(&(
                    right.kind.store_name(),
                    right.name.as_str(),
                    right.native_path.as_str(),
                ))
        });
        Ok(AgentToolProviderInventory {
            provider: self.provider,
            installed,
            items,
            limitations: provider_limitations(self.provider),
            errors,
        })
    }

    pub fn find(&self, locator: &AgentToolLocator) -> Result<AgentTool, AgentToolError> {
        self.discover()?
            .items
            .into_iter()
            .find(|item| {
                item.scope == locator.scope
                    && item.kind == locator.kind
                    && item.name == locator.name
                    && locator
                        .installation_id
                        .as_deref()
                        .is_none_or(|id| id == tool_installation_id(item))
                    && locator
                        .native_path
                        .as_deref()
                        .is_none_or(|path| path == item.native_path)
            })
            .ok_or_else(|| AgentToolError::NotFound(locator.name.clone()))
    }

    fn create(&self, request: ResolvedCreateAgentToolRequest) -> Result<AgentTool, AgentToolError> {
        if !self.is_installed()? {
            return Err(AgentToolError::Unsupported(format!(
                "{} is not installed",
                self.provider.id()
            )));
        }
        let existing = self.find(&request.target).ok();
        if let Some(existing) = existing {
            if !request.replace {
                return Err(AgentToolError::Collision(request.target.name));
            }
            let expected = request.expected_revision.as_deref().ok_or_else(|| {
                AgentToolError::InvalidRequest(
                    "replace requires the current target revision".into(),
                )
            })?;
            ensure_revision(&existing.revision, expected)?;
            let mut definition = request.definition;
            preserve_target_provider_extensions(&mut definition, &existing.definition);
            return self.update(ResolvedUpdateAgentToolRequest {
                target: request.target,
                expected_revision: expected.to_string(),
                definition,
            });
        }

        match &request.definition {
            AgentToolDefinition::McpServer(definition) => {
                validate_mcp_definition(definition)?;
                let path = self.resolve_mcp_path(&request.target, false)?;
                self.write_mcp_entry(&path, &request.target.name, Some(definition), None)?;
            }
            AgentToolDefinition::Skill(definition) => {
                let root = self.skill_root(request.target.scope)?;
                let target = root.join(&request.target.name);
                let definition =
                    prepare_provider_skill(self.provider, &request.target.name, definition)?;
                write_skill_directory(&target, &definition, false)?;
            }
        }
        self.find(&request.target).map_err(|error| {
            AgentToolError::VerificationFailed(format!("created item was not observable: {error}"))
        })
    }

    fn update(&self, request: ResolvedUpdateAgentToolRequest) -> Result<AgentTool, AgentToolError> {
        let current = self.find(&request.target)?;
        ensure_revision(&current.revision, &request.expected_revision)?;
        if !current.capabilities.editable {
            return Err(AgentToolError::Unsupported(
                "this native installation is read-only".into(),
            ));
        }
        if current.state != AgentToolState::Enabled {
            return Err(AgentToolError::Unsupported(
                "enable an item before editing it".into(),
            ));
        }
        match &request.definition {
            AgentToolDefinition::McpServer(definition) => {
                validate_mcp_definition(definition)?;
                self.write_mcp_entry(
                    Path::new(&current.native_path),
                    &request.target.name,
                    Some(definition),
                    Some(&request.expected_revision),
                )?;
            }
            AgentToolDefinition::Skill(definition) => {
                let definition = prepare_provider_skill(self.provider, &current.name, definition)?;
                write_skill_directory(Path::new(&current.native_path), &definition, true)?;
            }
        }
        self.find(&request.target).map_err(|error| {
            AgentToolError::VerificationFailed(format!("updated item was not observable: {error}"))
        })
    }

    pub fn remove(&self, request: RemoveAgentToolRequest) -> Result<(), AgentToolError> {
        let current = self.find(&request.target)?;
        ensure_revision(&current.revision, &request.expected_revision)?;
        if !current.capabilities.removable {
            return Err(AgentToolError::Unsupported(
                "this shared/native installation cannot be removed here".into(),
            ));
        }
        if current.state == AgentToolState::Disabled
            && !(current.kind == AgentToolKind::McpServer && uses_native_mcp_toggle(self.provider))
        {
            remove_disabled_path(Path::new(&current.native_path), current.kind)?;
            return Ok(());
        }
        match current.kind {
            AgentToolKind::McpServer => self.write_mcp_entry(
                Path::new(&current.native_path),
                &request.target.name,
                None,
                Some(&request.expected_revision),
            )?,
            AgentToolKind::Skill => {
                validate_skill_tree(Path::new(&current.native_path))?;
                fs::remove_dir_all(&current.native_path)?;
            }
        }
        if self.find(&request.target).is_ok() {
            return Err(AgentToolError::VerificationFailed(
                "removed item is still discoverable".into(),
            ));
        }
        Ok(())
    }

    pub fn set_enabled(
        &self,
        request: ToggleAgentToolRequest,
    ) -> Result<AgentTool, AgentToolError> {
        let current = self.find(&request.target)?;
        ensure_revision(&current.revision, &request.expected_revision)?;
        if !current.capabilities.toggleable {
            return Err(AgentToolError::Unsupported(
                "this shared/native installation cannot be toggled here".into(),
            ));
        }
        let already_enabled = current.state == AgentToolState::Enabled;
        if already_enabled == request.enabled {
            return Ok(current);
        }

        if current.kind == AgentToolKind::McpServer && uses_native_mcp_toggle(self.provider) {
            let AgentToolDefinition::McpServer(mut definition) = current.definition else {
                unreachable!("MCP item has MCP definition")
            };
            let mut source = definition
                .source_metadata
                .as_object()
                .cloned()
                .unwrap_or_default();
            if self.provider == AgentToolProvider::DeepseekHarness {
                source.insert("__dsh_disabled".into(), Value::Bool(!request.enabled));
            } else {
                source.insert("enabled".into(), Value::Bool(request.enabled));
            }
            definition.source_metadata = Value::Object(source);
            if self.provider == AgentToolProvider::DeepseekHarness {
                self.write_dsh_toggle(
                    Path::new(&current.native_path),
                    &definition,
                    !request.enabled,
                    &request.expected_revision,
                )?;
            } else {
                self.write_mcp_entry(
                    Path::new(&current.native_path),
                    &request.target.name,
                    Some(&definition),
                    Some(&request.expected_revision),
                )?;
            }
            return self.find(&request.target);
        }

        if request.enabled {
            self.restore_from_disabled(&request.target, &current)?;
        } else {
            self.move_to_disabled(&request.target, &current)?;
        }
        let mut observed_locator = request.target;
        observed_locator.installation_id = None;
        observed_locator.native_path = None;
        self.find(&observed_locator).map_err(|error| {
            AgentToolError::VerificationFailed(format!("toggle result was not observable: {error}"))
        })
    }

    fn provider_root(&self) -> PathBuf {
        match self.provider {
            AgentToolProvider::Codex => self.home_dir.join(".codex"),
            AgentToolProvider::ClaudeCode => self.home_dir.join(".claude"),
            AgentToolProvider::Gemini => self.home_dir.join(".gemini"),
            AgentToolProvider::OhMyPi => self.home_dir.join(".omp"),
            AgentToolProvider::Opencode => native_assets::opencode_root_for(&self.home_dir),
            AgentToolProvider::DeepseekHarness => native_assets::deepseek_home_for(&self.home_dir),
        }
    }

    fn project_root(&self) -> Result<&Path, AgentToolError> {
        let path = self.project_path.as_deref().ok_or_else(|| {
            AgentToolError::InvalidRequest("project scope requires project_path".into())
        })?;
        if !path.is_absolute() {
            return Err(AgentToolError::UnsafePath(
                "project_path must be absolute".into(),
            ));
        }
        if !path.is_dir() {
            return Err(AgentToolError::InvalidRequest(format!(
                "project directory does not exist: {}",
                path.display()
            )));
        }
        Ok(path)
    }

    fn mcp_candidates(&self, scope: AgentToolScope) -> Result<Vec<PathBuf>, AgentToolError> {
        let project = || self.project_root();
        Ok(match (self.provider, scope) {
            (AgentToolProvider::Codex, AgentToolScope::User) => {
                vec![self.home_dir.join(".codex/config.toml")]
            }
            (AgentToolProvider::Codex, AgentToolScope::Project) => {
                vec![project()?.join(".codex/config.toml")]
            }
            (AgentToolProvider::ClaudeCode, AgentToolScope::User) => {
                vec![self.home_dir.join(".claude.json")]
            }
            (AgentToolProvider::ClaudeCode, AgentToolScope::Project) => {
                vec![project()?.join(".mcp.json")]
            }
            (AgentToolProvider::Gemini, AgentToolScope::User) => {
                vec![self.home_dir.join(".gemini/settings.json")]
            }
            (AgentToolProvider::Gemini, AgentToolScope::Project) => {
                vec![project()?.join(".gemini/settings.json")]
            }
            (AgentToolProvider::OhMyPi, AgentToolScope::User) => vec![
                self.home_dir.join(".omp/agent/mcp.json"),
                self.home_dir.join(".omp/agent/.mcp.json"),
            ],
            (AgentToolProvider::OhMyPi, AgentToolScope::Project) => vec![
                project()?.join(".omp/mcp.json"),
                project()?.join(".omp/.mcp.json"),
            ],
            (AgentToolProvider::Opencode, AgentToolScope::User) => {
                let mut candidates: Vec<_> = native_assets::opencode_config_roots(&self.home_dir)
                    .into_iter()
                    .flat_map(|root| native_assets::opencode_config_candidates(&root, true))
                    .collect();
                if let Some(path) = native_assets::opencode_custom_config(&self.home_dir) {
                    if !candidates.contains(&path) {
                        candidates.push(path);
                    }
                }
                candidates
            }
            (AgentToolProvider::Opencode, AgentToolScope::Project) => {
                native_assets::opencode_config_candidates(project()?, false)
                    .into_iter()
                    .chain(native_assets::opencode_config_candidates(
                        &project()?.join(".opencode"),
                        false,
                    ))
                    .collect()
            }
            (AgentToolProvider::DeepseekHarness, AgentToolScope::User) => {
                let root = native_assets::deepseek_home_for(&self.home_dir);
                vec![
                    root.join("profiles/acp/cordis.patch.yml"),
                    root.join("cordis.patch.yml"),
                ]
            }
            (AgentToolProvider::DeepseekHarness, AgentToolScope::Project) => {
                return Err(AgentToolError::Unsupported(
                    "DeepSeek Harness has no automatic project MCP configuration".into(),
                ));
            }
        })
    }

    fn skill_root(&self, scope: AgentToolScope) -> Result<PathBuf, AgentToolError> {
        let boundary = match scope {
            AgentToolScope::User => self.home_dir.as_path(),
            AgentToolScope::Project => self.project_root()?,
        };
        let root = match (self.provider, scope) {
            (AgentToolProvider::Codex, AgentToolScope::User) => self.home_dir.join(".codex/skills"),
            (AgentToolProvider::Codex, AgentToolScope::Project) => {
                self.project_root()?.join(".agents/skills")
            }
            (AgentToolProvider::ClaudeCode, AgentToolScope::User) => {
                self.home_dir.join(".claude/skills")
            }
            (AgentToolProvider::ClaudeCode, AgentToolScope::Project) => {
                self.project_root()?.join(".claude/skills")
            }
            (AgentToolProvider::Gemini, AgentToolScope::User) => {
                self.home_dir.join(".gemini/skills")
            }
            (AgentToolProvider::Gemini, AgentToolScope::Project) => {
                self.project_root()?.join(".gemini/skills")
            }
            (AgentToolProvider::OhMyPi, AgentToolScope::User) => {
                self.home_dir.join(".omp/agent/skills")
            }
            (AgentToolProvider::OhMyPi, AgentToolScope::Project) => {
                self.project_root()?.join(".omp/skills")
            }
            (AgentToolProvider::Opencode, AgentToolScope::User) => {
                native_assets::opencode_asset_root_for(&self.home_dir).join("skills")
            }
            (AgentToolProvider::Opencode, AgentToolScope::Project) => {
                self.project_root()?.join(".opencode/skills")
            }
            (AgentToolProvider::DeepseekHarness, AgentToolScope::User) => {
                native_assets::deepseek_home_for(&self.home_dir).join("skills")
            }
            (AgentToolProvider::DeepseekHarness, AgentToolScope::Project) => {
                native_assets::deepseek_project_root(self.project_root()?).join(".dsh/skills")
            }
        };
        if root.starts_with(boundary) {
            ensure_no_symlink_components(boundary, &root)?;
        } else {
            ensure_native_root_safe(&root)?;
        }
        Ok(root)
    }

    fn resolve_mcp_path(
        &self,
        locator: &AgentToolLocator,
        must_exist: bool,
    ) -> Result<PathBuf, AgentToolError> {
        let candidates = self.mcp_candidates(locator.scope)?;
        if let Some(native_path) = &locator.native_path {
            let requested = PathBuf::from(native_path);
            if !candidates.iter().any(|candidate| candidate == &requested) {
                return Err(AgentToolError::UnsafePath(format!(
                    "MCP config is not a native {} path",
                    self.provider.id()
                )));
            }
            if must_exist && !requested.is_file() {
                return Err(AgentToolError::NotFound(native_path.clone()));
            }
            return Ok(requested);
        }
        if self.provider == AgentToolProvider::Opencode {
            return Ok(match locator.scope {
                AgentToolScope::User => native_assets::opencode_custom_config(&self.home_dir)
                    .unwrap_or_else(|| {
                        native_assets::opencode_write_target(
                            &native_assets::opencode_asset_root_for(&self.home_dir),
                            true,
                        )
                    }),
                AgentToolScope::Project => {
                    native_assets::opencode_write_target(self.project_root()?, false)
                }
            });
        }
        if self.provider == AgentToolProvider::DeepseekHarness {
            return Ok(native_assets::deepseek_home_for(&self.home_dir).join("cordis.patch.yml"));
        }
        if let Some(existing) = candidates.iter().find(|candidate| candidate.is_file()) {
            return Ok(existing.clone());
        }
        if must_exist {
            return Err(AgentToolError::NotFound(format!(
                "{} MCP config",
                self.provider.id()
            )));
        }
        candidates
            .into_iter()
            .next()
            .ok_or_else(|| AgentToolError::Unsupported("provider has no MCP config path".into()))
    }

    fn discover_mcp(
        &self,
        scope: AgentToolScope,
        output: &mut Vec<AgentTool>,
    ) -> Result<(), AgentToolError> {
        if self.provider == AgentToolProvider::DeepseekHarness {
            return self.discover_dsh_mcp(scope, output);
        }
        let mut failures = Vec::new();
        for path in self
            .mcp_candidates(scope)?
            .into_iter()
            .filter(|path| path.is_file())
        {
            match read_native_config(&path, self.provider) {
                Ok(config) => {
                    let revision = hash_file(&path)?;
                    let config = config.as_object().ok_or_else(|| {
                        AgentToolError::InvalidConfiguration(format!(
                            "{} root must be an object",
                            path.display()
                        ))
                    })?;
                    let servers = match config.get(mcp_servers_key(self.provider)) {
                        Some(value) => value.as_object().cloned().ok_or_else(|| {
                            AgentToolError::InvalidConfiguration(format!(
                                "{} must be an object in {}",
                                mcp_servers_key(self.provider),
                                path.display()
                            ))
                        })?,
                        None => Map::new(),
                    };
                    for (name, native) in servers {
                        if name == "meta" {
                            continue;
                        }
                        match normalize_mcp(self.provider, &native) {
                            Ok((definition, enabled)) => output.push(AgentTool {
                                provider: self.provider,
                                scope,
                                kind: AgentToolKind::McpServer,
                                name,
                                native_path: path.to_string_lossy().into_owned(),
                                state: if enabled {
                                    AgentToolState::Enabled
                                } else {
                                    AgentToolState::Disabled
                                },
                                capabilities: AgentToolCapabilities {
                                    removable: self.provider != AgentToolProvider::DeepseekHarness
                                        || definition
                                            .source_metadata
                                            .get("__dsh_plugin")
                                            .and_then(Value::as_str)
                                            == Some("@deepseek-ai/dsh-mcp-client"),
                                    ..AgentToolCapabilities::default()
                                },
                                revision: revision.clone(),
                                definition: AgentToolDefinition::McpServer(definition),
                                error: None,
                            }),
                            Err(error) => output.push(AgentTool {
                                provider: self.provider,
                                scope,
                                kind: AgentToolKind::McpServer,
                                name,
                                native_path: path.to_string_lossy().into_owned(),
                                state: AgentToolState::Error,
                                capabilities: AgentToolCapabilities {
                                    editable: false,
                                    toggleable: false,
                                    exportable: false,
                                    ..AgentToolCapabilities::default()
                                },
                                revision: revision.clone(),
                                definition: AgentToolDefinition::McpServer(empty_mcp_definition()),
                                error: Some(error.to_string()),
                            }),
                        }
                    }
                }
                Err(error) => failures.push(format!("{}: {error}", path.display())),
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(AgentToolError::InvalidConfiguration(failures.join("; ")))
        }
    }

    fn discover_dsh_mcp(
        &self,
        scope: AgentToolScope,
        output: &mut Vec<AgentTool>,
    ) -> Result<(), AgentToolError> {
        let mut rows: BTreeMap<String, (Value, PathBuf, String, bool)> = BTreeMap::new();
        let mut failures = Vec::new();
        for path in self.mcp_candidates(scope)? {
            if !path.is_file() {
                continue;
            }
            ensure_native_root_safe(&path)?;
            let content = fs::read_to_string(&path)?;
            let parsed = match native_assets::parse_cordis_patch(&content) {
                Ok(value) => value,
                Err(error) => {
                    failures.push(error);
                    continue;
                }
            };
            let revision = format!("{:x}", Sha256::digest(content.as_bytes()));
            for (id, row) in parsed.as_object().expect("Cordis parser returns object") {
                let previous = rows.remove(id);
                let shadowed = previous.is_some();
                let mut merged = previous
                    .map(|(row, _, _, _)| row)
                    .unwrap_or_else(|| Value::Object(Map::new()));
                let object = merged.as_object_mut().expect("Cordis plugin is an object");
                for (key, value) in row.as_object().expect("Cordis plugin is an object") {
                    object.insert(key.clone(), value.clone());
                }
                let removable = !shadowed
                    && row.get("name").and_then(Value::as_str)
                        == Some("@deepseek-ai/dsh-mcp-client");
                rows.insert(
                    id.clone(),
                    (merged, path.clone(), revision.clone(), removable),
                );
            }
        }
        for (id, (row, path, revision, removable)) in rows {
            let Some(config) = row.get("config").and_then(Value::as_object) else {
                continue;
            };
            if row.get("name").and_then(Value::as_str) != Some("@deepseek-ai/dsh-mcp-client")
                && !(config.contains_key("serverName") && config.contains_key("transport"))
            {
                continue;
            }
            let Some(name) = config.get("serverName").and_then(Value::as_str) else {
                continue;
            };
            let mut native = config.clone();
            native.insert("__dsh_id".into(), Value::String(id));
            native.insert(
                "__dsh_disabled".into(),
                row.get("disabled").cloned().unwrap_or(Value::Bool(false)),
            );
            if let Some(plugin) = row.get("name") {
                native.insert("__dsh_plugin".into(), plugin.clone());
            }
            let (definition, state, error) =
                match normalize_mcp(self.provider, &Value::Object(native)) {
                    Ok((definition, enabled)) => (
                        definition,
                        if enabled {
                            AgentToolState::Enabled
                        } else {
                            AgentToolState::Disabled
                        },
                        None,
                    ),
                    Err(error) => (
                        empty_mcp_definition(),
                        AgentToolState::Error,
                        Some(error.to_string()),
                    ),
                };
            let managed = error.is_none() && failures.is_empty();
            output.push(AgentTool {
                provider: self.provider,
                scope,
                kind: AgentToolKind::McpServer,
                name: name.to_string(),
                native_path: path.to_string_lossy().into_owned(),
                state,
                capabilities: AgentToolCapabilities {
                    editable: managed,
                    toggleable: managed,
                    removable: managed && removable,
                    exportable: error.is_none(),
                    installable: true,
                },
                revision,
                definition: AgentToolDefinition::McpServer(definition),
                error,
            });
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(AgentToolError::InvalidConfiguration(failures.join("; ")))
        }
    }

    fn discover_skills(
        &self,
        scope: AgentToolScope,
        output: &mut Vec<AgentTool>,
    ) -> Result<(), AgentToolError> {
        let roots = if scope == AgentToolScope::Project {
            self.project_skill_roots_for_discovery()?
        } else {
            self.user_skill_roots_for_discovery()?
        };
        let owned_root = self.skill_root(scope)?;
        for root in roots.into_iter().filter(|root| root.is_dir()) {
            for entry in fs::read_dir(&root)? {
                let entry = entry?;
                let file_type = entry.file_type()?;
                if self.provider == AgentToolProvider::DeepseekHarness
                    && file_type.is_file()
                    && entry
                        .path()
                        .extension()
                        .and_then(|extension| extension.to_str())
                        == Some("md")
                {
                    let path = entry.path();
                    ensure_native_root_safe(&path)?;
                    let bytes = fs::read(&path)?;
                    if bytes.len() > MAX_SKILL_BYTES {
                        continue;
                    }
                    let definition = SkillDefinition {
                        description: skill_description(&String::from_utf8_lossy(&bytes)),
                        files: vec![SkillFile {
                            path: "SKILL.md".into(),
                            content_base64: BASE64.encode(&bytes),
                        }],
                    };
                    let name = native_skill_name(&definition)?;
                    output.push(AgentTool {
                        provider: self.provider,
                        scope,
                        kind: AgentToolKind::Skill,
                        name,
                        native_path: path.to_string_lossy().into_owned(),
                        state: AgentToolState::Enabled,
                        capabilities: AgentToolCapabilities {
                            editable: false,
                            removable: false,
                            toggleable: false,
                            exportable: true,
                            installable: false,
                        },
                        revision: format!("{:x}", Sha256::digest(&bytes)),
                        definition: AgentToolDefinition::Skill(definition),
                        error: None,
                    });
                    continue;
                }
                if file_type.is_symlink() || !file_type.is_dir() {
                    continue;
                }
                let path = entry.path();
                if !path.join("SKILL.md").is_file() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().into_owned();
                match read_skill_definition(&path).and_then(|(definition, revision)| {
                    if matches!(
                        self.provider,
                        AgentToolProvider::Opencode | AgentToolProvider::DeepseekHarness
                    ) {
                        let native_name = native_skill_name(&definition)?;
                        if self.provider == AgentToolProvider::Opencode && native_name != name {
                            return Err(AgentToolError::InvalidConfiguration(
                                "OpenCode Skill name must match its directory".into(),
                            ));
                        }
                        prepare_provider_skill(self.provider, &name, &definition)?;
                    }
                    Ok((definition, revision))
                }) {
                    Ok((definition, revision)) => output.push(AgentTool {
                        provider: self.provider,
                        scope,
                        kind: AgentToolKind::Skill,
                        name,
                        native_path: path.to_string_lossy().into_owned(),
                        state: AgentToolState::Enabled,
                        capabilities: if matches!(
                            self.provider,
                            AgentToolProvider::Opencode | AgentToolProvider::DeepseekHarness
                        ) && root != owned_root
                        {
                            AgentToolCapabilities {
                                editable: false,
                                removable: false,
                                toggleable: false,
                                exportable: true,
                                installable: false,
                            }
                        } else {
                            AgentToolCapabilities::default()
                        },
                        revision,
                        definition: AgentToolDefinition::Skill(definition),
                        error: None,
                    }),
                    Err(error) => output.push(AgentTool {
                        provider: self.provider,
                        scope,
                        kind: AgentToolKind::Skill,
                        name,
                        native_path: path.to_string_lossy().into_owned(),
                        state: AgentToolState::Error,
                        capabilities: AgentToolCapabilities {
                            editable: false,
                            toggleable: false,
                            exportable: false,
                            ..AgentToolCapabilities::default()
                        },
                        revision: String::new(),
                        definition: AgentToolDefinition::Skill(SkillDefinition {
                            description: None,
                            files: Vec::new(),
                        }),
                        error: Some(error.to_string()),
                    }),
                }
            }
        }
        Ok(())
    }

    fn user_skill_roots_for_discovery(&self) -> Result<Vec<PathBuf>, AgentToolError> {
        let mut roots = vec![self.skill_root(AgentToolScope::User)?];
        match self.provider {
            AgentToolProvider::Opencode => {
                roots.extend(
                    native_assets::opencode_config_roots(&self.home_dir)
                        .into_iter()
                        .map(|root| root.join("skills")),
                );
                roots.extend([
                    self.home_dir.join(".agents/skills"),
                    self.home_dir.join(".claude/skills"),
                ]);
            }
            AgentToolProvider::DeepseekHarness => {
                roots.push(native_assets::deepseek_agents_home_for(&self.home_dir).join("skills"))
            }
            _ => {}
        }
        roots.sort();
        roots.dedup();
        for root in &roots {
            ensure_native_root_safe(root)?;
        }
        Ok(roots)
    }

    fn project_skill_roots_for_discovery(&self) -> Result<Vec<PathBuf>, AgentToolError> {
        let project = self.project_root()?;
        let mut roots = Vec::new();
        for ancestor in project.ancestors() {
            let root = match self.provider {
                AgentToolProvider::Codex => ancestor.join(".agents/skills"),
                AgentToolProvider::ClaudeCode => ancestor.join(".claude/skills"),
                AgentToolProvider::Gemini => ancestor.join(".gemini/skills"),
                AgentToolProvider::OhMyPi => ancestor.join(".omp/skills"),
                AgentToolProvider::Opencode => ancestor.join(".opencode/skills"),
                AgentToolProvider::DeepseekHarness => {
                    native_assets::deepseek_project_root(project).join(".dsh/skills")
                }
            };
            ensure_native_root_safe(&root)?;
            if !roots.contains(&root) {
                roots.push(root);
            }
            if matches!(
                self.provider,
                AgentToolProvider::Opencode | AgentToolProvider::DeepseekHarness
            ) {
                let base = if self.provider == AgentToolProvider::DeepseekHarness {
                    native_assets::deepseek_project_root(project)
                } else {
                    ancestor
                };
                for relative in if self.provider == AgentToolProvider::Opencode {
                    vec![".agents/skills", ".claude/skills"]
                } else {
                    vec![".agents/skills"]
                } {
                    let root = base.join(relative);
                    ensure_native_root_safe(&root)?;
                    if !roots.contains(&root) {
                        roots.push(root);
                    }
                }
            }
            if self.provider == AgentToolProvider::DeepseekHarness {
                break;
            }
            if ancestor.join(".git").exists() {
                break;
            }
        }
        Ok(roots)
    }

    fn disabled_kind_root(&self, scope: AgentToolScope, kind: AgentToolKind) -> PathBuf {
        self.disabled_root
            .join(self.provider.id())
            .join(scope.store_name())
            .join(kind.store_name())
    }

    fn discover_disabled(
        &self,
        scope: AgentToolScope,
        output: &mut Vec<AgentTool>,
    ) -> Result<(), AgentToolError> {
        let mcp_root = self.disabled_kind_root(scope, AgentToolKind::McpServer);
        if mcp_root.is_dir() {
            for entry in fs::read_dir(&mcp_root)? {
                let path = entry?.path();
                if path.extension().and_then(|value| value.to_str()) != Some("json") {
                    continue;
                }
                let record = read_disabled_record(&path)?;
                output.push(disabled_record_item(record, &path, hash_file(&path)?));
            }
        }

        let skill_root = self.disabled_kind_root(scope, AgentToolKind::Skill);
        if skill_root.is_dir() {
            for entry in fs::read_dir(&skill_root)? {
                let path = entry?.path();
                if path.extension().and_then(|value| value.to_str()) != Some("json")
                    || !path
                        .file_name()
                        .and_then(|value| value.to_str())
                        .is_some_and(|name| name.ends_with(".manifest.json"))
                {
                    continue;
                }
                let record = read_disabled_record(&path)?;
                let stored_dir = skill_root.join(&record.name);
                let (_, tree_revision) = read_skill_definition(&stored_dir)?;
                let revision = hash_disabled_skill_revision(&path, &tree_revision)?;
                output.push(disabled_record_item(record, &stored_dir, revision));
            }
        }
        Ok(())
    }

    fn write_mcp_entry(
        &self,
        path: &Path,
        name: &str,
        definition: Option<&McpServerDefinition>,
        expected_revision: Option<&str>,
    ) -> Result<(), AgentToolError> {
        validate_name(name)?;
        ensure_native_root_safe(path)?;
        let parent = path.parent().ok_or_else(|| {
            AgentToolError::UnsafePath("MCP config has no parent directory".into())
        })?;
        // Parse/validate before creating anything. An invalid native file
        // remains byte-for-byte unchanged.
        let (current, before_revision) = match fs::read_to_string(path) {
            Ok(content) => {
                let revision = format!("{:x}", Sha256::digest(content.as_bytes()));
                (content, revision)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                (String::new(), "missing".into())
            }
            Err(error) => return Err(AgentToolError::Io(error)),
        };
        if let Some(expected) = expected_revision {
            ensure_revision(&before_revision, expected)?;
        }
        let output = if self.provider == AgentToolProvider::DeepseekHarness {
            validate_dsh_mcp_name(name)?;
            let mut desired = native_assets::parse_cordis_patch(&current)
                .map_err(AgentToolError::InvalidConfiguration)?;
            let existing = desired
                .as_object()
                .and_then(|rows| {
                    rows.iter().find(|(_, row)| {
                        row.get("config")
                            .and_then(|config| config.get("serverName"))
                            .and_then(Value::as_str)
                            == Some(name)
                    })
                })
                .map(|(id, _)| id.clone());
            let id = existing
                .or_else(|| {
                    definition.and_then(|definition| {
                        definition
                            .source_metadata
                            .get("__dsh_id")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                    })
                })
                .unwrap_or_else(|| format!("vk-mcp-{name}"));
            if let Some(definition) = definition {
                let mut native = render_mcp(self.provider, definition)?;
                let object = native.as_object_mut().ok_or_else(|| {
                    AgentToolError::InvalidConfiguration("invalid native MCP config".into())
                })?;
                let disabled = object
                    .remove("__dsh_disabled")
                    .unwrap_or(Value::Bool(false));
                object.remove("__dsh_id");
                object.remove("__dsh_plugin");
                object.insert("serverName".into(), Value::String(name.into()));
                let rows = desired
                    .as_object_mut()
                    .expect("Cordis parser returns object");
                let row = rows.entry(id.clone()).or_insert_with(
                    || serde_json::json!({"id":id,"name":"@deepseek-ai/dsh-mcp-client"}),
                );
                row["config"] = native;
                row["disabled"] = disabled;
            } else {
                let row = desired
                    .get(&id)
                    .ok_or_else(|| AgentToolError::NotFound(name.into()))?;
                if row.get("name").and_then(Value::as_str) != Some("@deepseek-ai/dsh-mcp-client") {
                    return Err(AgentToolError::Unsupported("inherited MCP plugin cannot be removed from an override; remove its original insert in the native profile".into()));
                }
                desired
                    .as_object_mut()
                    .expect("Cordis parser returns object")
                    .remove(&id);
            }
            native_assets::render_cordis_patch(&current, &desired)
                .map_err(AgentToolError::Unsupported)?
        } else if self.provider == AgentToolProvider::Codex {
            let mut document = if current.trim().is_empty() {
                toml_edit::DocumentMut::new()
            } else {
                current
                    .parse::<toml_edit::DocumentMut>()
                    .map_err(|error| AgentToolError::InvalidConfiguration(error.to_string()))?
            };
            let root = document.as_table_mut();
            if !root.contains_key("mcp_servers") {
                root.insert(
                    "mcp_servers",
                    toml_edit::Item::Table(toml_edit::Table::new()),
                );
            }
            let servers = root
                .get_mut("mcp_servers")
                .and_then(toml_edit::Item::as_table_like_mut)
                .ok_or_else(|| {
                    AgentToolError::InvalidConfiguration("mcp_servers must be a TOML table".into())
                })?;
            if let Some(definition) = definition {
                let native = render_mcp(self.provider, definition)?;
                let value = native
                    .serialize(toml_edit::ser::ValueSerializer::new())
                    .map_err(|error| AgentToolError::InvalidConfiguration(error.to_string()))?;
                servers.insert(name, toml_edit::Item::Value(value));
            } else {
                servers.remove(name);
            }
            document.to_string()
        } else {
            let mut config =
                if current.trim().is_empty() && self.provider == AgentToolProvider::Opencode {
                    Value::Object(Map::new())
                } else if current.trim().is_empty() {
                    direct_provider_mcp_config(self.provider.into()).template
                } else if is_jsonc(path) || self.provider == AgentToolProvider::Opencode {
                    jsonc_parser::parse_to_serde_value(&current, &ParseOptions::default())
                        .map_err(|error| AgentToolError::InvalidConfiguration(error.to_string()))?
                        .unwrap_or_else(|| Value::Object(Map::new()))
                } else {
                    serde_json::from_str(&current)
                        .map_err(|error| AgentToolError::InvalidConfiguration(error.to_string()))?
                };
            let servers = config
                .as_object_mut()
                .ok_or_else(|| {
                    AgentToolError::InvalidConfiguration("config root must be an object".into())
                })?
                .entry(mcp_servers_key(self.provider))
                .or_insert_with(|| Value::Object(Map::new()))
                .as_object_mut()
                .ok_or_else(|| {
                    AgentToolError::InvalidConfiguration("mcpServers must be an object".into())
                })?;
            if let Some(definition) = definition {
                servers.insert(name.to_string(), render_mcp(self.provider, definition)?);
            } else {
                servers.remove(name);
            }
            if is_jsonc(path) || self.provider == AgentToolProvider::Opencode {
                update_jsonc_content(&current, &config)
            } else {
                serde_json::to_string_pretty(&config)
                    .map_err(|error| AgentToolError::InvalidConfiguration(error.to_string()))?
            }
        };
        let observed_revision = if path.is_file() {
            hash_file(path)?
        } else {
            "missing".into()
        };
        ensure_revision(&observed_revision, &before_revision)?;
        fs::create_dir_all(parent)?;
        atomic_write(path, output.as_bytes())?;

        let observed = read_native_config(path, self.provider)?;
        let present = observed
            .get(mcp_servers_key(self.provider))
            .and_then(Value::as_object)
            .is_some_and(|servers| servers.contains_key(name));
        if present != definition.is_some() {
            return Err(AgentToolError::VerificationFailed(format!(
                "MCP server {name} did not round-trip"
            )));
        }
        Ok(())
    }

    fn write_dsh_toggle(
        &self,
        path: &Path,
        definition: &McpServerDefinition,
        disabled: bool,
        expected: &str,
    ) -> Result<(), AgentToolError> {
        ensure_native_root_safe(path)?;
        let bytes = fs::read(path)?;
        ensure_revision(&format!("{:x}", Sha256::digest(&bytes)), expected)?;
        let source = std::str::from_utf8(&bytes).map_err(|_| {
            AgentToolError::InvalidConfiguration("native Cordis patch must be UTF-8".into())
        })?;
        let mut desired = native_assets::parse_cordis_patch(source)
            .map_err(AgentToolError::InvalidConfiguration)?;
        let id = definition
            .source_metadata
            .get("__dsh_id")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                AgentToolError::InvalidConfiguration("native MCP plugin identity is missing".into())
            })?;
        let row = desired
            .as_object_mut()
            .expect("Cordis parser returns object")
            .entry(id.to_string())
            .or_insert_with(|| serde_json::json!({"id": id}));
        row["disabled"] = Value::Bool(disabled);
        let output = native_assets::render_cordis_patch(source, &desired)
            .map_err(AgentToolError::Unsupported)?;
        ensure_revision(&hash_file(path)?, expected)?;
        atomic_write(path, output.as_bytes())
    }

    fn move_to_disabled(
        &self,
        locator: &AgentToolLocator,
        current: &AgentTool,
    ) -> Result<(), AgentToolError> {
        let root = self.disabled_kind_root(locator.scope, locator.kind);
        fs::create_dir_all(&root)?;
        let record = DisabledRecord {
            version: DISABLED_STORE_VERSION,
            provider: self.provider,
            scope: locator.scope,
            name: locator.name.clone(),
            original_native_path: current.native_path.clone(),
            definition: current.definition.clone(),
        };
        match locator.kind {
            AgentToolKind::McpServer => {
                let record_path = root.join(format!("{}.json", locator.name));
                if record_path.exists() {
                    return Err(AgentToolError::Collision(locator.name.clone()));
                }
                atomic_write_json(&record_path, &record)?;
                if let Err(error) = self.write_mcp_entry(
                    Path::new(&current.native_path),
                    &locator.name,
                    None,
                    Some(&current.revision),
                ) {
                    let _ = fs::remove_file(record_path);
                    return Err(error);
                }
            }
            AgentToolKind::Skill => {
                let stored_dir = root.join(&locator.name);
                let manifest = root.join(format!("{}.manifest.json", locator.name));
                if stored_dir.exists() || manifest.exists() {
                    return Err(AgentToolError::Collision(locator.name.clone()));
                }
                move_skill_directory(Path::new(&current.native_path), &stored_dir)?;
                if let Err(error) = atomic_write_json(&manifest, &record) {
                    let _ = move_skill_directory(&stored_dir, Path::new(&current.native_path));
                    return Err(error);
                }
            }
        }
        Ok(())
    }

    fn restore_from_disabled(
        &self,
        locator: &AgentToolLocator,
        current: &AgentTool,
    ) -> Result<(), AgentToolError> {
        let root = self.disabled_kind_root(locator.scope, locator.kind);
        match locator.kind {
            AgentToolKind::McpServer => {
                let record_path = Path::new(&current.native_path);
                let record = read_disabled_record(record_path)?;
                let target_path = PathBuf::from(&record.original_native_path);
                if !self
                    .mcp_candidates(locator.scope)?
                    .iter()
                    .any(|candidate| candidate == &target_path)
                {
                    return Err(AgentToolError::UnsafePath(
                        "disabled MCP manifest points outside provider paths".into(),
                    ));
                }
                if mcp_entry_exists(&target_path, self.provider, &locator.name)? {
                    return Err(AgentToolError::Collision(locator.name.clone()));
                }
                let AgentToolDefinition::McpServer(definition) = record.definition else {
                    return Err(AgentToolError::InvalidConfiguration(
                        "disabled MCP record contains the wrong kind".into(),
                    ));
                };
                self.write_mcp_entry(&target_path, &locator.name, Some(&definition), None)?;
                fs::remove_file(record_path)?;
            }
            AgentToolKind::Skill => {
                let manifest = root.join(format!("{}.manifest.json", locator.name));
                let record = read_disabled_record(&manifest)?;
                let target_path = PathBuf::from(&record.original_native_path);
                let valid_roots = if locator.scope == AgentToolScope::Project {
                    self.project_skill_roots_for_discovery()?
                } else {
                    vec![self.skill_root(locator.scope)?]
                };
                if !valid_roots
                    .iter()
                    .any(|root| root.join(&locator.name) == target_path)
                {
                    return Err(AgentToolError::UnsafePath(
                        "disabled Skill manifest points outside provider root".into(),
                    ));
                }
                if target_path.exists() {
                    return Err(AgentToolError::Collision(locator.name.clone()));
                }
                move_skill_directory(Path::new(&current.native_path), &target_path)?;
                fs::remove_file(manifest)?;
            }
        }
        Ok(())
    }
}

fn preserve_target_provider_extensions(
    replacement: &mut AgentToolDefinition,
    current: &AgentToolDefinition,
) {
    if let (AgentToolDefinition::McpServer(replacement), AgentToolDefinition::McpServer(current)) =
        (replacement, current)
    {
        replacement.source_metadata = current.source_metadata.clone();
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DisabledRecord {
    version: u32,
    provider: AgentToolProvider,
    scope: AgentToolScope,
    name: String,
    original_native_path: String,
    definition: AgentToolDefinition,
}

fn disabled_record_item(record: DisabledRecord, stored_path: &Path, revision: String) -> AgentTool {
    AgentTool {
        provider: record.provider,
        scope: record.scope,
        kind: record.definition.kind(),
        name: record.name,
        native_path: stored_path.to_string_lossy().into_owned(),
        state: AgentToolState::Disabled,
        capabilities: AgentToolCapabilities::default(),
        revision,
        definition: record.definition,
        error: None,
    }
}

fn validate_locator(locator: &AgentToolLocator) -> Result<(), AgentToolError> {
    validate_name(&locator.name)?;
    if locator.scope == AgentToolScope::Project && locator.project_path.is_none() {
        return Err(AgentToolError::InvalidRequest(
            "project scope requires project_path".into(),
        ));
    }
    Ok(())
}

fn provider_limitations(provider: AgentToolProvider) -> Vec<String> {
    match provider {
        AgentToolProvider::OhMyPi => vec![
            "Oh My Pi management targets the canonical agent profile at ~/.omp/agent; alternate OMP profiles are not managed."
                .to_string(),
        ],
        AgentToolProvider::Opencode => vec!["OpenCode uses native enabled switches. Compatible .agents/.claude Skills are shared physical installations and read-only here; copy to the OpenCode root to manage independently. OAuth grants are not portable MCP credentials. Inline/managed configuration and per-agent permissions may override file settings.".into()],
        AgentToolProvider::DeepseekHarness => vec!["DeepSeek Harness is a developer preview. MCP management targets native ACP/home Cordis patches, not project config. Executable YAML/include/custom-profile compositions are read-only. Shared .agents Skills are read-only; flat Markdown Skills are not editable bundle installations. Deleting inherited plugin overrides is unsupported; disable the native plugin instead.".into()],
        _ => Vec::new(),
    }
}

fn validate_name(name: &str) -> Result<(), AgentToolError> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.len() > 128
        || !name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "_-.".contains(character))
    {
        return Err(AgentToolError::UnsafePath(format!(
            "invalid tool name {name:?}"
        )));
    }
    Ok(())
}

fn ensure_revision(current: &str, expected: &str) -> Result<(), AgentToolError> {
    if current == expected {
        Ok(())
    } else {
        Err(AgentToolError::StaleRevision)
    }
}

fn mcp_servers_key(provider: AgentToolProvider) -> &'static str {
    match provider {
        AgentToolProvider::Codex => "mcp_servers",
        AgentToolProvider::ClaudeCode | AgentToolProvider::Gemini | AgentToolProvider::OhMyPi => {
            "mcpServers"
        }
        AgentToolProvider::Opencode => "mcp",
        AgentToolProvider::DeepseekHarness => "mcpServers",
    }
}

fn is_jsonc(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("jsonc"))
}

fn read_native_config(path: &Path, provider: AgentToolProvider) -> Result<Value, AgentToolError> {
    let content = fs::read_to_string(path)?;
    if content.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    if provider == AgentToolProvider::Codex {
        let value: toml::Value = toml::from_str(&content)
            .map_err(|error| AgentToolError::InvalidConfiguration(error.to_string()))?;
        serde_json::to_value(value)
            .map_err(|error| AgentToolError::InvalidConfiguration(error.to_string()))
    } else if provider == AgentToolProvider::DeepseekHarness {
        native_assets::cordis_mcp_config(&content).map_err(AgentToolError::InvalidConfiguration)
    } else if is_jsonc(path) || provider == AgentToolProvider::Opencode {
        jsonc_parser::parse_to_serde_value(&content, &ParseOptions::default())
            .map_err(|error| AgentToolError::InvalidConfiguration(error.to_string()))?
            .ok_or_else(|| AgentToolError::InvalidConfiguration("empty JSONC document".into()))
    } else {
        serde_json::from_str(&content)
            .map_err(|error| AgentToolError::InvalidConfiguration(error.to_string()))
    }
}

fn mcp_entry_exists(
    path: &Path,
    provider: AgentToolProvider,
    name: &str,
) -> Result<bool, AgentToolError> {
    if !path.is_file() {
        return Ok(false);
    }
    Ok(read_native_config(path, provider)?
        .get(mcp_servers_key(provider))
        .and_then(Value::as_object)
        .is_some_and(|servers| servers.contains_key(name)))
}

fn empty_mcp_definition() -> McpServerDefinition {
    McpServerDefinition {
        transport: McpTransport::Stdio,
        command: None,
        args: Vec::new(),
        cwd: None,
        env: BTreeMap::new(),
        url: None,
        headers: BTreeMap::new(),
        source_metadata: Value::Null,
    }
}

fn normalize_mcp(
    provider: AgentToolProvider,
    native: &Value,
) -> Result<(McpServerDefinition, bool), AgentToolError> {
    let object = native.as_object().ok_or_else(|| {
        AgentToolError::InvalidConfiguration("MCP server entry must be an object".into())
    })?;
    if provider == AgentToolProvider::Opencode {
        let enabled = match object.get("enabled") {
            None => true,
            Some(Value::Bool(enabled)) => *enabled,
            _ => {
                return Err(AgentToolError::InvalidConfiguration(
                    "OpenCode MCP enabled must be boolean".into(),
                ));
            }
        };
        let native_type = object.get("type").and_then(Value::as_str);
        let (transport, command, args, url) = match native_type {
            Some("local") => {
                let mut command = string_array(object.get("command"), "command")?.into_iter();
                let executable = command
                    .next()
                    .filter(|value| !value.trim().is_empty())
                    .ok_or_else(|| {
                        AgentToolError::InvalidConfiguration(
                            "OpenCode local MCP requires a command array".into(),
                        )
                    })?;
                (
                    McpTransport::Stdio,
                    Some(executable),
                    command.collect(),
                    None,
                )
            }
            Some("remote") => (
                McpTransport::Http,
                None,
                Vec::new(),
                optional_string(object.get("url"), "url")?,
            ),
            _ => {
                return Err(AgentToolError::InvalidConfiguration(
                    "OpenCode MCP type must be local or remote".into(),
                ));
            }
        };
        let definition = McpServerDefinition {
            transport,
            command,
            args,
            cwd: optional_string(object.get("cwd"), "cwd")?,
            env: string_map(object.get("environment"), "environment")?,
            url,
            headers: string_map(object.get("headers"), "headers")?,
            source_metadata: native.clone(),
        };
        validate_mcp_definition(&definition)?;
        return Ok((definition, enabled));
    }
    if provider == AgentToolProvider::DeepseekHarness {
        match object.get("transport").and_then(Value::as_str) {
            Some("stdio" | "streamable-http") => {}
            _ => {
                return Err(AgentToolError::InvalidConfiguration(
                    "DeepSeek Harness ACP MCP supports stdio and streamable-http only".into(),
                ));
            }
        }
    }
    let remote_url = optional_string(
        match provider {
            AgentToolProvider::Gemini => object.get("httpUrl").or_else(|| object.get("url")),
            _ => object.get("url"),
        },
        "url",
    )?;
    let command = optional_string(object.get("command"), "command")?;
    let transport = if remote_url.is_some() {
        McpTransport::Http
    } else if command.is_some() {
        McpTransport::Stdio
    } else {
        return Err(AgentToolError::InvalidConfiguration(
            "MCP server needs either command or URL".into(),
        ));
    };
    let args = string_array(object.get("args"), "args")?;
    let env = string_map(object.get("env"), "env")?;
    let headers = string_map(
        match provider {
            AgentToolProvider::Codex => {
                object.get("http_headers").or_else(|| object.get("headers"))
            }
            _ => object.get("headers"),
        },
        "headers",
    )?;
    let enabled = if provider == AgentToolProvider::DeepseekHarness {
        match object.get("__dsh_disabled") {
            None => true,
            Some(Value::Bool(disabled)) => !*disabled,
            _ => {
                return Err(AgentToolError::InvalidConfiguration(
                    "DeepSeek Harness plugin disabled must be boolean".into(),
                ));
            }
        }
    } else if provider == AgentToolProvider::OhMyPi {
        !matches!(object.get("enabled"), Some(Value::Bool(false)))
            && !object
                .get("enabled")
                .and_then(Value::as_str)
                .is_some_and(|value| {
                    matches!(
                        value.to_ascii_lowercase().as_str(),
                        "0" | "false" | "disabled" | "off"
                    )
                })
    } else {
        true
    };
    Ok((
        McpServerDefinition {
            transport,
            command,
            args,
            cwd: optional_string(object.get("cwd"), "cwd")?,
            env,
            url: remote_url,
            headers,
            source_metadata: native.clone(),
        },
        enabled,
    ))
}

fn optional_string(value: Option<&Value>, field: &str) -> Result<Option<String>, AgentToolError> {
    if value.is_some_and(Value::is_null) {
        return Ok(None);
    }
    value
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                AgentToolError::InvalidConfiguration(format!("MCP {field} must be a string"))
            })
        })
        .transpose()
}

fn string_array(value: Option<&Value>, field: &str) -> Result<Vec<String>, AgentToolError> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    if value.is_null() {
        return Ok(Vec::new());
    }
    let values = value.as_array().ok_or_else(|| {
        AgentToolError::InvalidConfiguration(format!("MCP {field} must be an array"))
    })?;
    values
        .iter()
        .map(|value| {
            value.as_str().map(str::to_owned).ok_or_else(|| {
                AgentToolError::InvalidConfiguration(format!("MCP {field} entries must be strings"))
            })
        })
        .collect()
}

fn string_map(
    value: Option<&Value>,
    field: &str,
) -> Result<BTreeMap<String, String>, AgentToolError> {
    let Some(value) = value else {
        return Ok(BTreeMap::new());
    };
    if value.is_null() {
        return Ok(BTreeMap::new());
    }
    let object = value.as_object().ok_or_else(|| {
        AgentToolError::InvalidConfiguration(format!("MCP {field} must be an object"))
    })?;
    object
        .iter()
        .map(|(key, value)| {
            value
                .as_str()
                .map(|value| (key.clone(), value.to_owned()))
                .ok_or_else(|| {
                    AgentToolError::InvalidConfiguration(format!(
                        "MCP {field}.{key} must be a string"
                    ))
                })
        })
        .collect()
}

fn validate_mcp_definition(definition: &McpServerDefinition) -> Result<(), AgentToolError> {
    match definition.transport {
        McpTransport::Stdio => {
            if definition
                .command
                .as_deref()
                .is_none_or(|command| command.trim().is_empty())
            {
                return Err(AgentToolError::InvalidConfiguration(
                    "stdio MCP server requires a command".into(),
                ));
            }
        }
        McpTransport::Http => {
            if definition
                .url
                .as_deref()
                .is_none_or(|url| url.trim().is_empty())
            {
                return Err(AgentToolError::InvalidConfiguration(
                    "HTTP MCP server requires a URL".into(),
                ));
            }
        }
    }
    Ok(())
}

fn render_mcp(
    provider: AgentToolProvider,
    definition: &McpServerDefinition,
) -> Result<Value, AgentToolError> {
    validate_mcp_definition(definition)?;
    let mut object = definition
        .source_metadata
        .as_object()
        .cloned()
        .unwrap_or_default();
    for key in [
        "type",
        "command",
        "args",
        "cwd",
        "env",
        "environment",
        "transport",
        "url",
        "httpUrl",
        "headers",
        "http_headers",
    ] {
        object.remove(key);
    }
    match definition.transport {
        McpTransport::Stdio => {
            if provider == AgentToolProvider::Opencode {
                object.insert("type".into(), Value::String("local".into()));
                let mut command = vec![definition.command.clone().unwrap_or_default()];
                command.extend(definition.args.iter().cloned());
                object.insert("command".into(), serde_json::json!(command));
            } else {
                object.insert(
                    "command".into(),
                    Value::String(definition.command.clone().unwrap_or_default()),
                );
                if !definition.args.is_empty() {
                    object.insert("args".into(), serde_json::json!(definition.args));
                }
            }
            if provider == AgentToolProvider::DeepseekHarness {
                object.insert("transport".into(), Value::String("stdio".into()));
            }
            if let Some(cwd) = &definition.cwd {
                object.insert("cwd".into(), Value::String(cwd.clone()));
            }
            if !definition.env.is_empty() {
                object.insert(
                    if provider == AgentToolProvider::Opencode {
                        "environment"
                    } else {
                        "env"
                    }
                    .into(),
                    serde_json::json!(definition.env),
                );
            }
        }
        McpTransport::Http => {
            let url = Value::String(definition.url.clone().unwrap_or_default());
            match provider {
                AgentToolProvider::Gemini => {
                    object.insert("httpUrl".into(), url);
                }
                AgentToolProvider::Codex => {
                    object.insert("url".into(), url);
                }
                AgentToolProvider::ClaudeCode | AgentToolProvider::OhMyPi => {
                    object.insert("type".into(), Value::String("http".into()));
                    object.insert("url".into(), url);
                }
                AgentToolProvider::Opencode => {
                    object.insert("type".into(), Value::String("remote".into()));
                    object.insert("url".into(), url);
                    if !definition.headers.is_empty() && !object.contains_key("oauth") {
                        object.insert("oauth".into(), Value::Bool(false));
                    }
                }
                AgentToolProvider::DeepseekHarness => {
                    object.insert("transport".into(), Value::String("streamable-http".into()));
                    object.insert("url".into(), url);
                }
            }
            if !definition.headers.is_empty() {
                let key = if provider == AgentToolProvider::Codex {
                    "http_headers"
                } else {
                    "headers"
                };
                object.insert(key.into(), serde_json::json!(definition.headers));
            }
            if provider == AgentToolProvider::Gemini {
                let headers = object
                    .entry("headers")
                    .or_insert_with(|| Value::Object(Map::new()))
                    .as_object_mut()
                    .ok_or_else(|| {
                        AgentToolError::InvalidConfiguration(
                            "Gemini MCP headers must be an object".into(),
                        )
                    })?;
                headers
                    .entry("Accept")
                    .or_insert_with(|| Value::String("application/json, text/event-stream".into()));
            }
        }
    }
    if matches!(
        provider,
        AgentToolProvider::OhMyPi | AgentToolProvider::Opencode
    ) && !object.contains_key("enabled")
    {
        object.insert("enabled".into(), Value::Bool(true));
    }
    Ok(Value::Object(object))
}

fn uses_native_mcp_toggle(provider: AgentToolProvider) -> bool {
    matches!(
        provider,
        AgentToolProvider::OhMyPi
            | AgentToolProvider::Opencode
            | AgentToolProvider::DeepseekHarness
    )
}

fn validate_dsh_mcp_name(name: &str) -> Result<(), AgentToolError> {
    if name.is_empty()
        || name.len() > 32
        || !name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
    {
        return Err(AgentToolError::InvalidConfiguration(
            "DeepSeek Harness MCP names use 1–32 ASCII letters, digits, '_' or '-'".into(),
        ));
    }
    Ok(())
}

pub(crate) fn ensure_native_root_safe(root: &Path) -> Result<(), AgentToolError> {
    if !root.is_absolute() {
        return Err(AgentToolError::UnsafePath(
            "native root must be absolute".into(),
        ));
    }
    for component in root.ancestors() {
        match fs::symlink_metadata(component) {
            Ok(metadata) if metadata.file_type().is_symlink() || is_reparse_point(&metadata) => {
                return Err(AgentToolError::UnsafePath(
                    "native root contains a link/reparse point".into(),
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_: &fs::Metadata) -> bool {
    false
}

fn native_skill_name(definition: &SkillDefinition) -> Result<String, AgentToolError> {
    let manifest = definition
        .files
        .iter()
        .find(|file| file.path == "SKILL.md")
        .ok_or_else(|| AgentToolError::InvalidConfiguration("Skill requires SKILL.md".into()))?;
    let bytes = BASE64
        .decode(&manifest.content_base64)
        .map_err(|_| AgentToolError::InvalidConfiguration("invalid Skill encoding".into()))?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| AgentToolError::InvalidConfiguration("SKILL.md must be UTF-8".into()))?;
    let newline = if text.starts_with("---\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let prefix = format!("---{newline}");
    let marker = format!("{newline}---{newline}");
    let body = text.strip_prefix(&prefix).ok_or_else(|| {
        AgentToolError::InvalidConfiguration("native Skill requires YAML frontmatter".into())
    })?;
    let end = body.find(&marker).ok_or_else(|| {
        AgentToolError::InvalidConfiguration("Skill frontmatter is not closed".into())
    })?;
    let value =
        native_assets::parse_yaml(&body[..end]).map_err(AgentToolError::InvalidConfiguration)?;
    if value
        .get("description")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty())
    {
        return Err(AgentToolError::InvalidConfiguration(
            "native Skill requires a description".into(),
        ));
    }
    value
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| AgentToolError::InvalidConfiguration("native Skill requires a name".into()))
}

fn prepare_provider_skill(
    provider: AgentToolProvider,
    name: &str,
    definition: &SkillDefinition,
) -> Result<SkillDefinition, AgentToolError> {
    if !matches!(
        provider,
        AgentToolProvider::Opencode | AgentToolProvider::DeepseekHarness
    ) {
        return Ok(definition.clone());
    }
    if provider == AgentToolProvider::Opencode
        && (name.len() > 64
            || name.starts_with('-')
            || name.ends_with('-')
            || name.contains("--")
            || !name
                .chars()
                .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-'))
    {
        return Err(AgentToolError::InvalidConfiguration(
            "OpenCode Skill names must be lower-kebab-case, 1–64 characters".into(),
        ));
    }
    let mut definition = definition.clone();
    let manifest = definition
        .files
        .iter_mut()
        .find(|file| file.path == "SKILL.md")
        .ok_or_else(|| AgentToolError::InvalidConfiguration("Skill requires SKILL.md".into()))?;
    let bytes = BASE64.decode(&manifest.content_base64).map_err(|_| {
        AgentToolError::InvalidConfiguration("invalid Skill content encoding".into())
    })?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| AgentToolError::InvalidConfiguration("SKILL.md must be UTF-8".into()))?;
    let newline = if text.starts_with("---\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let prefix = format!("---{newline}");
    let body = text.strip_prefix(&prefix).ok_or_else(|| {
        AgentToolError::InvalidConfiguration(
            "Skill requires YAML name and description frontmatter".into(),
        )
    })?;
    let marker = format!("{newline}---{newline}");
    let end = body.find(&marker).ok_or_else(|| {
        AgentToolError::InvalidConfiguration("Skill frontmatter is not closed".into())
    })?;
    let frontmatter = &body[..end];
    let parsed =
        native_assets::parse_yaml(frontmatter).map_err(AgentToolError::InvalidConfiguration)?;
    let description = parsed
        .get("description")
        .and_then(Value::as_str)
        .filter(|description| !description.trim().is_empty())
        .ok_or_else(|| {
            AgentToolError::InvalidConfiguration("Skill requires a non-empty description".into())
        })?;
    if provider == AgentToolProvider::Opencode && description.len() > 1024 {
        return Err(AgentToolError::InvalidConfiguration(
            "OpenCode Skill description exceeds 1024 characters".into(),
        ));
    }
    let mut desired = parsed.clone();
    desired["name"] = Value::String(name.into());
    let rendered = native_assets::render_yaml_mapping(frontmatter, &parsed, &desired, 0)
        .map_err(AgentToolError::Unsupported)?;
    let content = format!(
        "{prefix}{}{marker}{}",
        rendered.trim_end_matches(['\r', '\n']),
        &body[end + marker.len()..]
    );
    manifest.content_base64 = BASE64.encode(content.as_bytes());
    Ok(definition)
}

fn validate_relative_skill_path(path: &str) -> Result<PathBuf, AgentToolError> {
    let path = PathBuf::from(path);
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AgentToolError::UnsafePath(format!(
            "invalid Skill bundle path {path:?}"
        )));
    }
    Ok(path)
}

fn ensure_no_symlink_components(boundary: &Path, target: &Path) -> Result<(), AgentToolError> {
    let relative = target.strip_prefix(boundary).map_err(|_| {
        AgentToolError::UnsafePath(format!(
            "Skill root {} is outside boundary {}",
            target.display(),
            boundary.display()
        ))
    })?;
    let mut current = boundary.to_path_buf();
    for component in relative.components() {
        let Component::Normal(component) = component else {
            return Err(AgentToolError::UnsafePath(format!(
                "Skill root contains an unsafe component: {}",
                target.display()
            )));
        };
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(AgentToolError::UnsafePath(format!(
                    "Skill root contains symlink: {}",
                    current.display()
                )));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(AgentToolError::Io(error)),
        }
    }
    Ok(())
}

fn validate_skill_definition(definition: &SkillDefinition) -> Result<usize, AgentToolError> {
    if definition.files.is_empty() || definition.files.len() > MAX_SKILL_FILES {
        return Err(AgentToolError::InvalidConfiguration(format!(
            "Skill must contain 1..={MAX_SKILL_FILES} files"
        )));
    }
    let mut total = 0usize;
    let mut has_contract = false;
    let mut paths = std::collections::HashSet::new();
    for file in &definition.files {
        let path = validate_relative_skill_path(&file.path)?;
        if !paths.insert(path.clone()) {
            return Err(AgentToolError::InvalidConfiguration(format!(
                "duplicate Skill path {}",
                file.path
            )));
        }
        has_contract |= path == Path::new("SKILL.md");
        let bytes = BASE64.decode(&file.content_base64).map_err(|error| {
            AgentToolError::InvalidConfiguration(format!(
                "{} is not valid base64: {error}",
                file.path
            ))
        })?;
        total = total.checked_add(bytes.len()).ok_or_else(|| {
            AgentToolError::InvalidConfiguration("Skill bundle is too large".into())
        })?;
        if total > MAX_SKILL_BYTES {
            return Err(AgentToolError::InvalidConfiguration(format!(
                "Skill exceeds {MAX_SKILL_BYTES} bytes"
            )));
        }
    }
    if !has_contract {
        return Err(AgentToolError::InvalidConfiguration(
            "Skill bundle must contain SKILL.md".into(),
        ));
    }
    Ok(total)
}

fn validate_skill_tree(root: &Path) -> Result<(), AgentToolError> {
    if !root.is_dir() {
        return Err(AgentToolError::NotFound(root.display().to_string()));
    }
    let mut files = 0usize;
    let mut bytes = 0usize;
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(|error| {
            AgentToolError::InvalidConfiguration(format!("Skill walk failed: {error}"))
        })?;
        if entry.file_type().is_symlink() {
            return Err(AgentToolError::UnsafePath(format!(
                "Skill contains symlink: {}",
                entry.path().display()
            )));
        }
        if entry.file_type().is_file() {
            files += 1;
            bytes = bytes
                .checked_add(
                    entry
                        .metadata()
                        .map_err(|error| AgentToolError::InvalidConfiguration(error.to_string()))?
                        .len() as usize,
                )
                .ok_or_else(|| AgentToolError::InvalidConfiguration("Skill is too large".into()))?;
            if files > MAX_SKILL_FILES || bytes > MAX_SKILL_BYTES {
                return Err(AgentToolError::InvalidConfiguration(
                    "Skill exceeds safe copy limits".into(),
                ));
            }
        }
    }
    if !root.join("SKILL.md").is_file() {
        return Err(AgentToolError::InvalidConfiguration(
            "Skill is missing SKILL.md".into(),
        ));
    }
    Ok(())
}

fn read_skill_definition(root: &Path) -> Result<(SkillDefinition, String), AgentToolError> {
    validate_skill_tree(root)?;
    let mut paths = Vec::new();
    for entry in WalkDir::new(root).follow_links(false) {
        let entry = entry.map_err(|error| {
            AgentToolError::InvalidConfiguration(format!("Skill walk failed: {error}"))
        })?;
        if entry.file_type().is_file() {
            paths.push(entry.path().to_path_buf());
        }
    }
    paths.sort();
    let mut hasher = Sha256::new();
    let mut files = Vec::with_capacity(paths.len());
    let mut skill_md = None;
    for path in paths {
        let relative = path.strip_prefix(root).map_err(|_| {
            AgentToolError::UnsafePath("Skill file escaped its declared root".into())
        })?;
        let bytes = fs::read(&path)?;
        let portable_path = relative.to_string_lossy().replace('\\', "/");
        hasher.update(portable_path.as_bytes());
        hasher.update([0]);
        hasher.update(&bytes);
        if relative == Path::new("SKILL.md") {
            skill_md = String::from_utf8(bytes.clone()).ok();
        }
        files.push(SkillFile {
            path: portable_path,
            content_base64: BASE64.encode(bytes),
        });
    }
    let description = skill_md.as_deref().and_then(skill_description);
    Ok((
        SkillDefinition { description, files },
        format!("{:x}", hasher.finalize()),
    ))
}

fn skill_description(content: &str) -> Option<String> {
    let mut in_frontmatter = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "---" {
            if in_frontmatter {
                break;
            }
            in_frontmatter = true;
            continue;
        }
        if in_frontmatter && let Some(description) = trimmed.strip_prefix("description:") {
            return Some(description.trim().trim_matches(['\'', '"']).to_string());
        }
    }
    content
        .lines()
        .find_map(|line| line.trim().strip_prefix("# ").map(str::to_owned))
}

fn write_skill_directory(
    target: &Path,
    definition: &SkillDefinition,
    replace: bool,
) -> Result<(), AgentToolError> {
    validate_skill_definition(definition)?;
    let root = target
        .parent()
        .ok_or_else(|| AgentToolError::UnsafePath("Skill target has no root".into()))?;
    fs::create_dir_all(root)?;
    if target.exists() && !replace {
        return Err(AgentToolError::Collision(target.display().to_string()));
    }
    if target.exists() {
        validate_skill_tree(target)?;
    }
    let stage = root.join(format!(".vibe-kanban-skill-{}", Uuid::new_v4()));
    fs::create_dir(&stage)?;
    let result = (|| {
        for file in &definition.files {
            let relative = validate_relative_skill_path(&file.path)?;
            let path = stage.join(relative);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            let bytes = BASE64
                .decode(&file.content_base64)
                .map_err(|error| AgentToolError::InvalidConfiguration(error.to_string()))?;
            fs::write(path, bytes)?;
        }
        validate_skill_tree(&stage)?;
        if target.exists() {
            let backup = root.join(format!(".vibe-kanban-backup-{}", Uuid::new_v4()));
            fs::rename(target, &backup)?;
            if let Err(error) = fs::rename(&stage, target) {
                let _ = fs::rename(&backup, target);
                return Err(AgentToolError::Io(error));
            }
            fs::remove_dir_all(backup)?;
        } else {
            fs::rename(&stage, target)?;
        }
        Ok(())
    })();
    if result.is_err() && stage.exists() {
        let _ = fs::remove_dir_all(stage);
    }
    result
}

fn move_skill_directory(source: &Path, target: &Path) -> Result<(), AgentToolError> {
    validate_skill_tree(source)?;
    if target.exists() {
        return Err(AgentToolError::Collision(target.display().to_string()));
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    match fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(_) => {
            let (definition, _) = read_skill_definition(source)?;
            write_skill_directory(target, &definition, false)?;
            fs::remove_dir_all(source)?;
            Ok(())
        }
    }
}

fn hash_file(path: &Path) -> Result<String, AgentToolError> {
    let bytes = fs::read(path)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn hash_disabled_skill_revision(
    manifest_path: &Path,
    tree_revision: &str,
) -> Result<String, AgentToolError> {
    let mut hasher = Sha256::new();
    hasher.update(fs::read(manifest_path)?);
    hasher.update([0]);
    hasher.update(tree_revision.as_bytes());
    Ok(format!("{:x}", hasher.finalize()))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), AgentToolError> {
    let parent = path
        .parent()
        .ok_or_else(|| AgentToolError::UnsafePath("write target has no parent".into()))?;
    fs::create_dir_all(parent)?;
    let mut temp = NamedTempFile::new_in(parent)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path)
        .map_err(|error| AgentToolError::Io(error.error))?;
    Ok(())
}

fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), AgentToolError> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| AgentToolError::InvalidConfiguration(error.to_string()))?;
    atomic_write(path, &bytes)
}

fn read_disabled_record(path: &Path) -> Result<DisabledRecord, AgentToolError> {
    let record: DisabledRecord = serde_json::from_slice(&fs::read(path)?)
        .map_err(|error| AgentToolError::InvalidConfiguration(error.to_string()))?;
    if record.version != DISABLED_STORE_VERSION {
        return Err(AgentToolError::Unsupported(format!(
            "disabled store version {}",
            record.version
        )));
    }
    validate_name(&record.name)?;
    Ok(record)
}

fn remove_disabled_path(path: &Path, kind: AgentToolKind) -> Result<(), AgentToolError> {
    match kind {
        AgentToolKind::McpServer => fs::remove_file(path)?,
        AgentToolKind::Skill => {
            validate_skill_tree(path)?;
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .ok_or_else(|| AgentToolError::UnsafePath("invalid disabled Skill name".into()))?;
            fs::remove_dir_all(path)?;
            let manifest = path
                .parent()
                .ok_or_else(|| AgentToolError::UnsafePath("invalid disabled Skill root".into()))?
                .join(format!("{name}.manifest.json"));
            if manifest.exists() {
                fs::remove_file(manifest)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
    use tempfile::TempDir;

    use super::*;

    fn harness() -> (TempDir, AgentToolService) {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let service = AgentToolService::new(
            home.clone(),
            root.path().join("assets/agent-tools/disabled/v1"),
        );
        for provider_root in [
            ".codex",
            ".claude",
            ".gemini",
            ".omp",
            ".config/opencode",
            ".dsh",
        ] {
            fs::create_dir_all(home.join(provider_root)).unwrap();
        }
        (root, service)
    }

    #[cfg(unix)]
    fn symlink_dir(source: &Path, target: &Path) -> std::io::Result<()> {
        std::os::unix::fs::symlink(source, target)
    }

    #[cfg(windows)]
    fn symlink_dir(source: &Path, target: &Path) -> std::io::Result<()> {
        std::os::windows::fs::symlink_dir(source, target)
    }

    fn locator(provider: AgentToolProvider, kind: AgentToolKind, name: &str) -> AgentToolLocator {
        AgentToolLocator {
            provider,
            scope: AgentToolScope::User,
            kind,
            name: name.into(),
            installation_id: None,
            native_path: None,
            project_path: None,
        }
    }

    fn native_stdio(command: &str) -> AgentToolDefinition {
        AgentToolDefinition::McpServer(McpServerDefinition {
            transport: McpTransport::Stdio,
            command: Some(command.into()),
            args: vec!["--serve".into()],
            cwd: None,
            env: BTreeMap::from([("RAW_TOKEN".into(), "${TOKEN}".into())]),
            url: None,
            headers: BTreeMap::new(),
            source_metadata: Value::Null,
        })
    }

    fn stdio(command: &str) -> AgentToolWriteDefinition {
        AgentToolWriteDefinition::McpServer(McpServerWriteDefinition {
            transport: McpTransport::Stdio,
            command: SensitiveStringWrite::Replace {
                value: command.into(),
            },
            args: SensitiveStringListWrite::Replace {
                value: vec!["--serve".into()],
            },
            cwd: SensitiveStringWrite::Clear,
            env: SensitiveStringMapWrite::Replace {
                value: BTreeMap::from([("RAW_TOKEN".into(), "${TOKEN}".into())]),
            },
            url: SensitiveStringWrite::Clear,
            headers: SensitiveStringMapWrite::Clear,
        })
    }

    fn native_skill_with_binary() -> SkillDefinition {
        SkillDefinition {
            description: Some("test Skill".into()),
            files: vec![
                SkillFile {
                    path: "SKILL.md".into(),
                    content_base64: BASE64.encode(b"---\ndescription: test Skill\n---\n# Test\n"),
                },
                SkillFile {
                    path: "assets/icon.bin".into(),
                    content_base64: BASE64.encode([0, 159, 146, 150, 255]),
                },
            ],
        }
    }

    fn skill_with_binary() -> AgentToolWriteDefinition {
        AgentToolWriteDefinition::Skill(SkillWriteDefinition::Replace {
            value: native_skill_with_binary(),
        })
    }

    #[test]
    fn new_providers_toggle_native_mcp_without_moving_entries() {
        let (_root, service) = harness();
        for provider in [
            AgentToolProvider::Opencode,
            AgentToolProvider::DeepseekHarness,
        ] {
            let target = locator(provider, AgentToolKind::McpServer, "native-toggle");
            let created = service
                .create(CreateAgentToolRequest {
                    target: target.clone(),
                    definition: stdio("npx"),
                    replace: false,
                    expected_revision: None,
                })
                .unwrap();
            let disabled = service
                .set_enabled(ToggleAgentToolRequest {
                    target: target.clone(),
                    expected_revision: created.revision.clone(),
                    enabled: false,
                })
                .unwrap();
            assert_eq!(disabled.state, AgentToolState::Disabled);
            let native = service.get(&target).unwrap();
            assert!(Path::new(&native.native_path).is_file());
            if provider == AgentToolProvider::Opencode {
                let config = read_native_config(Path::new(&native.native_path), provider).unwrap();
                assert_eq!(config["mcp"]["native-toggle"]["enabled"], false);
                assert_eq!(config["mcp"]["native-toggle"]["command"][0], "npx");
            } else {
                let config = native_assets::parse_cordis_patch(
                    &fs::read_to_string(&native.native_path).unwrap(),
                )
                .unwrap();
                assert_eq!(config["vk-mcp-native-toggle"]["disabled"], true);
            }
            assert!(matches!(
                service.set_enabled(ToggleAgentToolRequest {
                    target: target.clone(),
                    expected_revision: created.revision,
                    enabled: true
                }),
                Err(AgentToolError::StaleRevision)
            ));
            let enabled = service
                .set_enabled(ToggleAgentToolRequest {
                    target: target.clone(),
                    expected_revision: disabled.revision,
                    enabled: true,
                })
                .unwrap();
            service
                .remove(RemoveAgentToolRequest {
                    target,
                    expected_revision: enabled.revision,
                })
                .unwrap();
        }
    }

    #[test]
    fn opencode_json_file_mcp_edits_preserve_comments_and_unknown_settings() {
        let (_root, service) = harness();
        let path = service.home_dir.join(".config/opencode/opencode.json");
        fs::write(&path, "{\n// preserved\n\"model\":\"vendor/model\",\n\"mcp\": {\"example\":{\"type\":\"local\",\"command\":[\"npx\",\"serve\"],\"timeout\":30}}\n}").unwrap();
        let target = locator(
            AgentToolProvider::Opencode,
            AgentToolKind::McpServer,
            "example",
        );
        let current = service.get(&target).unwrap();
        service
            .set_enabled(ToggleAgentToolRequest {
                target,
                expected_revision: current.revision,
                enabled: false,
            })
            .unwrap();
        let source = fs::read_to_string(path).unwrap();
        assert!(source.contains("// preserved"));
        let value = jsonc_parser::parse_to_serde_value(&source, &ParseOptions::default())
            .unwrap()
            .unwrap();
        assert_eq!(value["mcp"]["example"]["timeout"], 30);
        assert_eq!(value["model"], "vendor/model");
    }

    #[test]
    fn dsh_mcp_patch_toggle_preserves_unrelated_yaml_and_has_no_project_scope() {
        let (_root, service) = harness();
        let path = service.home_dir.join(".dsh/cordis.patch.yml");
        fs::write(&path, "# native doc\n- insert:\n    - id: my-tool\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: example\n        transport: stdio\n        command: npx\n        timeout: 30 # keep timeout\n- id: unrelated\n  config:\n    keep: true\n").unwrap();
        let target = locator(
            AgentToolProvider::DeepseekHarness,
            AgentToolKind::McpServer,
            "example",
        );
        let current = service.get(&target).unwrap();
        service
            .set_enabled(ToggleAgentToolRequest {
                target,
                expected_revision: current.revision,
                enabled: false,
            })
            .unwrap();
        let source = fs::read_to_string(&path).unwrap();
        assert!(source.contains("# native doc"));
        assert!(source.contains("timeout: 30 # keep timeout"));
        assert_eq!(
            native_assets::parse_cordis_patch(&source).unwrap()["unrelated"]["config"]["keep"],
            true
        );
        let project = service.home_dir.join("project");
        fs::create_dir_all(&project).unwrap();
        let manager = service.manager(AgentToolProvider::DeepseekHarness, Some(&project));
        assert!(matches!(
            manager.mcp_candidates(AgentToolScope::Project),
            Err(AgentToolError::Unsupported(_))
        ));
        assert!(!project.join(".dsh/cordis.patch.yml").exists());
    }

    #[test]
    fn shared_native_skills_are_exportable_but_not_mutable() {
        let (_root, service) = harness();
        let path = service.home_dir.join(".agents/skills/shared-skill");
        fs::create_dir_all(&path).unwrap();
        fs::write(
            path.join("SKILL.md"),
            "---\nname: shared-skill\ndescription: shared native skill\n---\n# Native\n",
        )
        .unwrap();
        for provider in [
            AgentToolProvider::Opencode,
            AgentToolProvider::DeepseekHarness,
        ] {
            let target = locator(provider, AgentToolKind::Skill, "shared-skill");
            let item = service.get(&target).unwrap();
            assert!(item.capabilities.exportable);
            assert!(!item.capabilities.removable);
            assert!(!item.capabilities.toggleable);
            assert!(matches!(
                service.remove(RemoveAgentToolRequest {
                    target,
                    expected_revision: item.revision
                }),
                Err(AgentToolError::Unsupported(_))
            ));
        }
        assert!(path.join("SKILL.md").is_file());
    }

    #[test]
    fn dsh_flat_skill_is_discovered_with_read_only_capabilities() {
        let (_root, service) = harness();
        let root = service.home_dir.join(".dsh/skills");
        fs::create_dir_all(&root).unwrap();
        fs::write(
            root.join("flat.md"),
            "---\nname: flat\ndescription: native flat skill\n---\nInstructions\n",
        )
        .unwrap();
        let item = service
            .get(&locator(
                AgentToolProvider::DeepseekHarness,
                AgentToolKind::Skill,
                "flat",
            ))
            .unwrap();
        assert_eq!(item.state, AgentToolState::Enabled);
        assert!(item.capabilities.exportable);
        assert!(!item.capabilities.editable);
        assert!(!item.capabilities.toggleable);
    }

    #[test]
    fn dsh_mcp_native_home_disabled_override_shadows_profile_without_resurrection() {
        let (_root, service) = harness();
        let profile = service.home_dir.join(".dsh/profiles/acp/cordis.patch.yml");
        fs::create_dir_all(profile.parent().unwrap()).unwrap();
        fs::write(&profile, "- insert:\n    - id: profile-tool\n      name: '@deepseek-ai/dsh-mcp-client'\n      config:\n        serverName: example\n        transport: stdio\n        command: npx\n").unwrap();
        let home = service.home_dir.join(".dsh/cordis.patch.yml");
        fs::write(
            &home,
            "# user override\n- id: profile-tool\n  disabled: true\n",
        )
        .unwrap();
        let target = locator(
            AgentToolProvider::DeepseekHarness,
            AgentToolKind::McpServer,
            "example",
        );
        let item = service.get(&target).unwrap();
        assert_eq!(item.state, AgentToolState::Disabled);
        assert_eq!(Path::new(&item.native_path), home);
        assert!(!item.capabilities.removable);
        assert!(matches!(
            service.remove(RemoveAgentToolRequest {
                target: target.clone(),
                expected_revision: item.revision.clone()
            }),
            Err(AgentToolError::Unsupported(_))
        ));
        let enabled = service
            .set_enabled(ToggleAgentToolRequest {
                target,
                expected_revision: item.revision,
                enabled: true,
            })
            .unwrap();
        assert_eq!(enabled.state, AgentToolState::Enabled);
        let source = fs::read_to_string(home).unwrap();
        assert!(source.contains("# user override"));
        assert!(!source.contains("config:"));
    }

    #[test]
    fn provider_inventory_pins_correct_omp_and_codex_skill_paths() {
        let (_root, service) = harness();
        let project = service.home_dir.join("project");
        fs::create_dir_all(&project).unwrap();
        let omp = service.manager(AgentToolProvider::OhMyPi, Some(&project));
        assert_eq!(
            omp.mcp_candidates(AgentToolScope::User).unwrap()[0],
            service.home_dir.join(".omp/agent/mcp.json")
        );
        assert_eq!(
            omp.skill_root(AgentToolScope::User).unwrap(),
            service.home_dir.join(".omp/agent/skills")
        );
        let codex = service.manager(AgentToolProvider::Codex, Some(&project));
        assert_eq!(
            codex.skill_root(AgentToolScope::Project).unwrap(),
            fs::canonicalize(project).unwrap().join(".agents/skills")
        );
    }

    #[test]
    fn opaque_installation_id_disambiguates_omp_canonical_and_legacy_entries() {
        let (_root, service) = harness();
        let omp_root = service.home_dir.join(".omp/agent");
        fs::create_dir_all(&omp_root).unwrap();
        let canonical_path = omp_root.join("mcp.json");
        let legacy_path = omp_root.join(".mcp.json");
        fs::write(
            &canonical_path,
            r#"{"mcpServers":{"duplicate":{"command":"canonical"}}}"#,
        )
        .unwrap();
        fs::write(
            &legacy_path,
            r#"{"mcpServers":{"duplicate":{"command":"legacy"}}}"#,
        )
        .unwrap();

        let legacy = service
            .manager(AgentToolProvider::OhMyPi, None)
            .discover()
            .unwrap()
            .items
            .into_iter()
            .find(|item| Path::new(&item.native_path) == legacy_path)
            .unwrap();
        let installation_id = tool_installation_id(&legacy);
        service
            .update(UpdateAgentToolRequest {
                target: AgentToolLocator {
                    installation_id: Some(installation_id),
                    ..locator(
                        AgentToolProvider::OhMyPi,
                        AgentToolKind::McpServer,
                        "duplicate",
                    )
                },
                expected_revision: legacy.revision,
                definition: AgentToolWriteDefinition::McpServer(McpServerWriteDefinition {
                    transport: McpTransport::Stdio,
                    command: SensitiveStringWrite::Replace {
                        value: "updated-legacy".into(),
                    },
                    args: SensitiveStringListWrite::Preserve,
                    cwd: SensitiveStringWrite::Preserve,
                    env: SensitiveStringMapWrite::Preserve,
                    url: SensitiveStringWrite::Preserve,
                    headers: SensitiveStringMapWrite::Preserve,
                }),
            })
            .unwrap();

        let canonical: Value = serde_json::from_slice(&fs::read(canonical_path).unwrap()).unwrap();
        let legacy: Value = serde_json::from_slice(&fs::read(legacy_path).unwrap()).unwrap();
        assert_eq!(canonical["mcpServers"]["duplicate"]["command"], "canonical");
        assert_eq!(
            legacy["mcpServers"]["duplicate"]["command"],
            "updated-legacy"
        );
    }

    #[test]
    fn codex_targeted_toml_write_preserves_comments_and_unrelated_tables() {
        let (_root, service) = harness();
        let path = service.home_dir.join(".codex/config.toml");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            "# keep me\nmodel = \"gpt-5\"\n\n[features]\nweb_search = true\n",
        )
        .unwrap();

        let created = service
            .create(CreateAgentToolRequest {
                target: locator(
                    AgentToolProvider::Codex,
                    AgentToolKind::McpServer,
                    "context7",
                ),
                definition: stdio("npx"),
                replace: false,
                expected_revision: None,
            })
            .unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("# keep me"));
        assert!(content.contains("[features]"));
        assert!(content.contains("context7"));

        let stale = service.update(UpdateAgentToolRequest {
            target: locator(
                AgentToolProvider::Codex,
                AgentToolKind::McpServer,
                "context7",
            ),
            expected_revision: "stale".into(),
            definition: stdio("node"),
        });
        assert!(matches!(stale, Err(AgentToolError::StaleRevision)));
        assert!(!created.revision.is_empty());
    }

    #[test]
    fn jsonc_targeted_write_preserves_comments_and_unrelated_fields() {
        let (_root, service) = harness();
        let manager = service.manager(AgentToolProvider::Gemini, None);
        let path = service.home_dir.join(".gemini/settings.jsonc");
        fs::write(
            &path,
            "{\n  // keep me\n  \"theme\": \"dark\",\n  \"mcpServers\": {\n    \"existing\": { \"command\": \"old\" }\n  }\n}\n",
        )
        .unwrap();

        let AgentToolDefinition::McpServer(definition) = native_stdio("new") else {
            unreachable!()
        };
        manager
            .write_mcp_entry(&path, "added", Some(&definition), None)
            .unwrap();
        let content = fs::read_to_string(&path).unwrap();
        assert!(content.contains("// keep me"));
        assert!(content.contains("\"theme\": \"dark\""));
        assert!(content.contains("\"existing\""));
        assert!(content.contains("\"added\""));
    }

    #[test]
    fn malformed_provider_is_isolated_and_malformed_entries_are_visible() {
        let (_root, service) = harness();
        fs::write(
            service.home_dir.join(".codex/config.toml"),
            "[mcp_servers.healthy]\ncommand = \"codex-server\"\n",
        )
        .unwrap();
        fs::write(
            service.home_dir.join(".gemini/settings.json"),
            r#"{"mcpServers": []}"#,
        )
        .unwrap();
        fs::write(
            service.home_dir.join(".claude.json"),
            r#"{"mcpServers":{"broken":{"command":"server","args":[1]}}}"#,
        )
        .unwrap();

        let inventory = service.discover(None);
        let codex = inventory
            .providers
            .iter()
            .find(|provider| provider.provider == AgentToolProvider::Codex)
            .unwrap();
        assert!(codex.items.iter().any(|item| item.name == "healthy"));
        let gemini = inventory
            .providers
            .iter()
            .find(|provider| provider.provider == AgentToolProvider::Gemini)
            .unwrap();
        assert_eq!(gemini.items.len(), 0);
        assert!(
            gemini
                .errors
                .iter()
                .any(|error| error.contains("must be an object"))
        );
        let claude = inventory
            .providers
            .iter()
            .find(|provider| provider.provider == AgentToolProvider::ClaudeCode)
            .unwrap();
        assert_eq!(claude.items[0].state, AgentToolState::Error);
        assert!(
            claude.items[0]
                .error
                .as_deref()
                .is_some_and(|error| error.contains("args entries must be strings"))
        );
    }

    #[test]
    fn skill_bundle_is_lossless_and_rejects_traversal() {
        let (_root, service) = harness();
        let created = service
            .create(CreateAgentToolRequest {
                target: locator(AgentToolProvider::Gemini, AgentToolKind::Skill, "binary"),
                definition: skill_with_binary(),
                replace: false,
                expected_revision: None,
            })
            .unwrap();
        assert_eq!(
            fs::read(Path::new(&created.native_path).join("assets/icon.bin")).unwrap(),
            [0, 159, 146, 150, 255]
        );

        let invalid = service.create(CreateAgentToolRequest {
            target: locator(AgentToolProvider::Gemini, AgentToolKind::Skill, "escape"),
            definition: AgentToolWriteDefinition::Skill(SkillWriteDefinition::Replace {
                value: SkillDefinition {
                    description: None,
                    files: vec![SkillFile {
                        path: "../SKILL.md".into(),
                        content_base64: BASE64.encode("bad"),
                    }],
                },
            }),
            replace: false,
            expected_revision: None,
        });
        assert!(matches!(invalid, Err(AgentToolError::UnsafePath(_))));
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn skill_create_rejects_symlinked_provider_root() {
        let (root, service) = harness();
        let project = root.path().join("project");
        let outside = root.path().join("outside");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(&outside).unwrap();
        if let Err(error) = symlink_dir(&outside, &project.join(".agents")) {
            #[cfg(windows)]
            if error.kind() == std::io::ErrorKind::PermissionDenied
                || error.raw_os_error() == Some(1314)
            {
                return;
            }
            panic!("failed to create test symlink: {error}");
        }

        let result = service.create(CreateAgentToolRequest {
            target: AgentToolLocator {
                scope: AgentToolScope::Project,
                project_path: Some(project.to_string_lossy().into_owned()),
                ..locator(AgentToolProvider::Codex, AgentToolKind::Skill, "unsafe")
            },
            definition: skill_with_binary(),
            replace: false,
            expected_revision: None,
        });

        assert!(matches!(result, Err(AgentToolError::UnsafePath(_))));
        assert!(!outside.join("skills/unsafe").exists());
    }

    #[test]
    fn emulated_skill_toggle_is_recoverable_and_not_delete() {
        let (_root, service) = harness();
        let created = service
            .create(CreateAgentToolRequest {
                target: locator(
                    AgentToolProvider::ClaudeCode,
                    AgentToolKind::Skill,
                    "toggle",
                ),
                definition: skill_with_binary(),
                replace: false,
                expected_revision: None,
            })
            .unwrap();
        let disabled = service
            .set_enabled(ToggleAgentToolRequest {
                target: AgentToolLocator {
                    installation_id: Some(tool_installation_id(&created)),
                    ..locator(
                        AgentToolProvider::ClaudeCode,
                        AgentToolKind::Skill,
                        "toggle",
                    )
                },
                expected_revision: created.revision,
                enabled: false,
            })
            .unwrap();
        assert_eq!(disabled.state, AgentToolState::Disabled);
        assert!(Path::new(&disabled.native_path).join("SKILL.md").is_file());

        let enabled = service
            .set_enabled(ToggleAgentToolRequest {
                target: AgentToolLocator {
                    installation_id: Some(tool_installation_id(&disabled)),
                    ..locator(
                        AgentToolProvider::ClaudeCode,
                        AgentToolKind::Skill,
                        "toggle",
                    )
                },
                expected_revision: disabled.revision,
                enabled: true,
            })
            .unwrap();
        assert_eq!(enabled.state, AgentToolState::Enabled);
        assert_eq!(
            fs::read(Path::new(&enabled.native_path).join("assets/icon.bin")).unwrap(),
            [0, 159, 146, 150, 255]
        );
    }

    #[test]
    fn disabled_skill_revision_includes_manifest_changes() {
        let (_root, service) = harness();
        let created = service
            .create(CreateAgentToolRequest {
                target: locator(AgentToolProvider::Codex, AgentToolKind::Skill, "revision"),
                definition: skill_with_binary(),
                replace: false,
                expected_revision: None,
            })
            .unwrap();
        let disabled = service
            .set_enabled(ToggleAgentToolRequest {
                target: locator(AgentToolProvider::Codex, AgentToolKind::Skill, "revision"),
                expected_revision: created.revision,
                enabled: false,
            })
            .unwrap();
        let manifest = Path::new(&disabled.native_path)
            .parent()
            .unwrap()
            .join("revision.manifest.json");
        let mut record: Value = serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
        record["definition"]["data"]["description"] = Value::String("externally changed".into());
        fs::write(&manifest, serde_json::to_vec_pretty(&record).unwrap()).unwrap();

        let stale = service.set_enabled(ToggleAgentToolRequest {
            target: AgentToolLocator {
                native_path: Some(disabled.native_path),
                ..locator(AgentToolProvider::Codex, AgentToolKind::Skill, "revision")
            },
            expected_revision: disabled.revision,
            enabled: true,
        });
        assert!(matches!(stale, Err(AgentToolError::StaleRevision)));
    }

    #[test]
    fn copy_collision_requires_explicit_replace_and_target_revision() {
        let (_root, service) = harness();
        let source = service
            .create(CreateAgentToolRequest {
                target: locator(
                    AgentToolProvider::Codex,
                    AgentToolKind::McpServer,
                    "replace",
                ),
                definition: stdio("source"),
                replace: false,
                expected_revision: None,
            })
            .unwrap();
        let target = service
            .create(CreateAgentToolRequest {
                target: locator(
                    AgentToolProvider::Gemini,
                    AgentToolKind::McpServer,
                    "replace",
                ),
                definition: stdio("target"),
                replace: false,
                expected_revision: None,
            })
            .unwrap();
        let copy = |replace, target_expected_revision| {
            service.copy(CopyAgentToolRequest {
                source: locator(
                    AgentToolProvider::Codex,
                    AgentToolKind::McpServer,
                    "replace",
                ),
                expected_revision: source.revision.clone(),
                target_provider: AgentToolProvider::Gemini,
                target_scope: AgentToolScope::User,
                target_project_path: None,
                target_name: None,
                replace,
                target_expected_revision,
            })
        };
        assert!(matches!(
            copy(false, None),
            Err(AgentToolError::Collision(_))
        ));
        assert!(matches!(
            copy(true, Some("stale".into())),
            Err(AgentToolError::StaleRevision)
        ));
        let replaced = copy(true, Some(target.revision)).unwrap();
        let AgentToolDefinitionSummary::McpServer(definition) = replaced.item.definition else {
            unreachable!()
        };
        assert_eq!(definition.command_display.as_deref(), Some("source"));
    }

    #[test]
    fn mcp_copy_keeps_only_the_destination_providers_native_extensions() {
        let (_root, service) = harness();
        let source_locator = locator(
            AgentToolProvider::Gemini,
            AgentToolKind::McpServer,
            "source-extensions",
        );
        service
            .create(CreateAgentToolRequest {
                target: source_locator.clone(),
                definition: stdio("source-command"),
                replace: false,
                expected_revision: None,
            })
            .unwrap();
        let source_path = service.home_dir.join(".gemini/settings.json");
        let mut source_native: Value =
            serde_json::from_slice(&fs::read(&source_path).unwrap()).unwrap();
        source_native["mcpServers"]["source-extensions"]["source_extension"] =
            Value::String("source-only-value".into());
        fs::write(
            &source_path,
            serde_json::to_vec_pretty(&source_native).unwrap(),
        )
        .unwrap();
        let source = service.get(&source_locator).unwrap();

        let same_provider = service
            .copy(CopyAgentToolRequest {
                source: source_locator.clone(),
                expected_revision: source.revision.clone(),
                target_provider: AgentToolProvider::Gemini,
                target_scope: AgentToolScope::User,
                target_project_path: None,
                target_name: Some("same-provider-copy".into()),
                replace: false,
                target_expected_revision: None,
            })
            .unwrap();
        let same_provider_native: Value =
            serde_json::from_slice(&fs::read(&source_path).unwrap()).unwrap();
        assert_eq!(
            same_provider_native["mcpServers"]["same-provider-copy"]["source_extension"],
            "source-only-value"
        );
        assert!(
            !serde_json::to_string(&same_provider)
                .unwrap()
                .contains("source-only-value")
        );
        let refreshed_source = service.get(&source_locator).unwrap();

        let target_locator = locator(
            AgentToolProvider::ClaudeCode,
            AgentToolKind::McpServer,
            "target-extensions",
        );
        service
            .create(CreateAgentToolRequest {
                target: target_locator.clone(),
                definition: stdio("target-command"),
                replace: false,
                expected_revision: None,
            })
            .unwrap();
        let target_path = service.home_dir.join(".claude.json");
        let mut target_native: Value =
            serde_json::from_slice(&fs::read(&target_path).unwrap()).unwrap();
        target_native["mcpServers"]["target-extensions"]["target_extension"] =
            Value::String("target-only-value".into());
        fs::write(
            &target_path,
            serde_json::to_vec_pretty(&target_native).unwrap(),
        )
        .unwrap();
        let target = service.get(&target_locator).unwrap();

        let cross_provider = service
            .copy(CopyAgentToolRequest {
                source: source_locator,
                expected_revision: refreshed_source.revision,
                target_provider: AgentToolProvider::ClaudeCode,
                target_scope: AgentToolScope::User,
                target_project_path: None,
                target_name: Some("target-extensions".into()),
                replace: true,
                target_expected_revision: Some(target.revision),
            })
            .unwrap();
        let target_native: Value =
            serde_json::from_slice(&fs::read(&target_path).unwrap()).unwrap();
        let target_entry = &target_native["mcpServers"]["target-extensions"];
        assert_eq!(target_entry["target_extension"], "target-only-value");
        assert!(target_entry.get("source_extension").is_none());
        let public_response = serde_json::to_string(&cross_provider).unwrap();
        assert!(!public_response.contains("target-only-value"));
        assert!(!public_response.contains("source-only-value"));
    }

    #[test]
    fn mcp_and_skill_copy_cover_every_provider_direction() {
        let (_root, service) = harness();
        for source_provider in AgentToolProvider::ALL {
            let source_name = format!("source-{}", source_provider.id().replace('_', "-"));
            let source_mcp = service
                .create(CreateAgentToolRequest {
                    target: locator(source_provider, AgentToolKind::McpServer, &source_name),
                    definition: stdio("npx"),
                    replace: false,
                    expected_revision: None,
                })
                .unwrap();
            let source_skill = service
                .create(CreateAgentToolRequest {
                    target: locator(source_provider, AgentToolKind::Skill, &source_name),
                    definition: skill_with_binary(),
                    replace: false,
                    expected_revision: None,
                })
                .unwrap();

            for target_provider in AgentToolProvider::ALL
                .into_iter()
                .filter(|provider| *provider != source_provider)
            {
                let target_name = format!(
                    "{}-to-{}",
                    source_provider.id().replace('_', "-"),
                    target_provider.id().replace('_', "-")
                );
                let copied = service
                    .copy(CopyAgentToolRequest {
                        source: locator(source_provider, AgentToolKind::McpServer, &source_name),
                        expected_revision: source_mcp.revision.clone(),
                        target_provider,
                        target_scope: AgentToolScope::User,
                        target_project_path: None,
                        target_name: Some(target_name.clone()),
                        replace: false,
                        target_expected_revision: None,
                    })
                    .unwrap();
                let AgentToolDefinitionSummary::McpServer(definition) = copied.item.definition
                else {
                    panic!("expected MCP definition")
                };
                assert_eq!(definition.command_display.as_deref(), Some("npx"));
                assert_eq!(definition.env_count, 1);

                service
                    .copy(CopyAgentToolRequest {
                        source: locator(source_provider, AgentToolKind::Skill, &source_name),
                        expected_revision: source_skill.revision.clone(),
                        target_provider,
                        target_scope: AgentToolScope::User,
                        target_project_path: None,
                        target_name: Some(target_name.clone()),
                        replace: false,
                        target_expected_revision: None,
                    })
                    .unwrap();
                let copied_skill = service
                    .get(&locator(
                        target_provider,
                        AgentToolKind::Skill,
                        &target_name,
                    ))
                    .unwrap();
                assert_eq!(
                    fs::read(Path::new(&copied_skill.native_path).join("assets/icon.bin")).unwrap(),
                    [0, 159, 146, 150, 255]
                );
            }
        }
    }

    #[test]
    fn omp_uses_native_enabled_field() {
        let (_root, service) = harness();
        let created = service
            .create(CreateAgentToolRequest {
                target: locator(
                    AgentToolProvider::OhMyPi,
                    AgentToolKind::McpServer,
                    "native-toggle",
                ),
                definition: stdio("server"),
                replace: false,
                expected_revision: None,
            })
            .unwrap();
        let disabled = service
            .set_enabled(ToggleAgentToolRequest {
                target: locator(
                    AgentToolProvider::OhMyPi,
                    AgentToolKind::McpServer,
                    "native-toggle",
                ),
                expected_revision: created.revision,
                enabled: false,
            })
            .unwrap();
        assert_eq!(disabled.state, AgentToolState::Disabled);
        let native: Value = serde_json::from_slice(
            &fs::read(service.home_dir.join(".omp/agent/mcp.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(native["mcpServers"]["native-toggle"]["enabled"], false);
    }

    #[test]
    fn public_tool_views_redact_native_mcp_and_skill_payloads() {
        let secret = "do-not-project-this-secret";
        let mcp = AgentTool {
            provider: AgentToolProvider::Codex,
            scope: AgentToolScope::User,
            kind: AgentToolKind::McpServer,
            name: "safe-name".into(),
            native_path: "C:/Users/private/.codex/config.toml".into(),
            state: AgentToolState::Enabled,
            capabilities: AgentToolCapabilities::default(),
            revision: "revision".into(),
            definition: AgentToolDefinition::McpServer(McpServerDefinition {
                transport: McpTransport::Http,
                command: Some(format!("C:/private/{secret}/server.exe")),
                args: vec!["--token".into(), secret.into()],
                cwd: Some(format!("C:/private/{secret}")),
                env: BTreeMap::from([("TOKEN".into(), secret.into())]),
                url: Some(format!(
                    "https://user:{secret}@example.com/mcp?token={secret}#x"
                )),
                headers: BTreeMap::from([("Authorization".into(), secret.into())]),
                source_metadata: serde_json::json!({ "provider_secret": secret }),
            }),
            error: None,
        };
        let payload = serde_json::to_string(&AgentToolView::from(mcp)).unwrap();
        assert!(!payload.contains(secret));
        assert!(!payload.contains("C:/Users/private"));
        assert!(payload.contains("https://example.com"));
        assert!(!payload.contains("userinfo"));

        let skill = AgentTool {
            provider: AgentToolProvider::Gemini,
            scope: AgentToolScope::User,
            kind: AgentToolKind::Skill,
            name: "safe-skill".into(),
            native_path: "C:/private/skill".into(),
            state: AgentToolState::Enabled,
            capabilities: AgentToolCapabilities::default(),
            revision: "revision".into(),
            definition: AgentToolDefinition::Skill(SkillDefinition {
                description: Some(secret.into()),
                files: vec![SkillFile {
                    path: "SKILL.md".into(),
                    content_base64: BASE64.encode(secret),
                }],
            }),
            error: None,
        };
        assert!(
            !serde_json::to_string(&AgentToolView::from(skill))
                .unwrap()
                .contains(secret)
        );
    }

    #[test]
    fn mcp_write_only_fields_preserve_replace_and_clear_native_values() {
        let (_root, service) = harness();
        let target = locator(
            AgentToolProvider::Gemini,
            AgentToolKind::McpServer,
            "write-only",
        );
        let created = service
            .create(CreateAgentToolRequest {
                target: target.clone(),
                definition: AgentToolWriteDefinition::McpServer(McpServerWriteDefinition {
                    transport: McpTransport::Stdio,
                    command: SensitiveStringWrite::Replace {
                        value: "original-command".into(),
                    },
                    args: SensitiveStringListWrite::Replace {
                        value: vec!["--token".into(), "original-secret".into()],
                    },
                    cwd: SensitiveStringWrite::Replace {
                        value: "C:/private/work".into(),
                    },
                    env: SensitiveStringMapWrite::Replace {
                        value: BTreeMap::from([("TOKEN".into(), "original-secret".into())]),
                    },
                    url: SensitiveStringWrite::Clear,
                    headers: SensitiveStringMapWrite::Clear,
                }),
                replace: false,
                expected_revision: None,
            })
            .unwrap();

        let preserved = service
            .update(UpdateAgentToolRequest {
                target: target.clone(),
                expected_revision: created.revision,
                definition: AgentToolWriteDefinition::McpServer(McpServerWriteDefinition {
                    transport: McpTransport::Stdio,
                    command: SensitiveStringWrite::Preserve,
                    args: SensitiveStringListWrite::Preserve,
                    cwd: SensitiveStringWrite::Preserve,
                    env: SensitiveStringMapWrite::Preserve,
                    url: SensitiveStringWrite::Preserve,
                    headers: SensitiveStringMapWrite::Preserve,
                }),
            })
            .unwrap();
        let native = service.get(&target).unwrap();
        let AgentToolDefinition::McpServer(native) = native.definition else {
            unreachable!()
        };
        assert_eq!(native.command.as_deref(), Some("original-command"));
        assert_eq!(native.args[1], "original-secret");
        assert_eq!(native.env["TOKEN"], "original-secret");

        service
            .update(UpdateAgentToolRequest {
                target,
                expected_revision: preserved.revision,
                definition: AgentToolWriteDefinition::McpServer(McpServerWriteDefinition {
                    transport: McpTransport::Stdio,
                    command: SensitiveStringWrite::Replace {
                        value: "replacement-command".into(),
                    },
                    args: SensitiveStringListWrite::Clear,
                    cwd: SensitiveStringWrite::Clear,
                    env: SensitiveStringMapWrite::Clear,
                    url: SensitiveStringWrite::Clear,
                    headers: SensitiveStringMapWrite::Clear,
                }),
            })
            .unwrap();
        let content = fs::read_to_string(service.home_dir.join(".gemini/settings.json")).unwrap();
        assert!(content.contains("replacement-command"));
        assert!(!content.contains("original-secret"));
        assert!(!content.contains("C:/private/work"));
    }
}
