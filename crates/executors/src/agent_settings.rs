//! Adapter-owned native settings management for direct agent providers.
//!
//! Native provider files remain authoritative. Discovery never creates or
//! changes them; mutations use descriptor-owned paths, full-file revisions,
//! targeted document edits, atomic replacement, and operation-level rollback.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use chrono::{DateTime, Utc};
use jsonc_parser::ParseOptions;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use thiserror::Error;
use toml_edit::{DocumentMut, Item};
use ts_rs::TS;
use uuid::Uuid;

use crate::{
    executors::provider_adapter::DirectProvider, mcp_config::update_jsonc_content,
    profile::ExecutorProfileId,
};

pub const SETTINGS_PROFILE_STORE_VERSION: u16 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum AgentSettingsProvider {
    Codex,
    ClaudeCode,
    Gemini,
    OhMyPi,
}

impl AgentSettingsProvider {
    pub const ALL: [Self; 4] = [Self::Codex, Self::ClaudeCode, Self::Gemini, Self::OhMyPi];

    pub const fn id(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::ClaudeCode => "claude_code",
            Self::Gemini => "gemini",
            Self::OhMyPi => "oh_my_pi",
        }
    }

    const fn executable(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::ClaudeCode => "claude",
            Self::Gemini => "gemini",
            Self::OhMyPi => "omp",
        }
    }
}

impl From<DirectProvider> for AgentSettingsProvider {
    fn from(value: DirectProvider) -> Self {
        match value {
            DirectProvider::Codex => Self::Codex,
            DirectProvider::ClaudeCode => Self::ClaudeCode,
            DirectProvider::Gemini => Self::Gemini,
            DirectProvider::OhMyPi => Self::OhMyPi,
        }
    }
}

impl From<AgentSettingsProvider> for DirectProvider {
    fn from(value: AgentSettingsProvider) -> Self {
        match value {
            AgentSettingsProvider::Codex => Self::Codex,
            AgentSettingsProvider::ClaudeCode => Self::ClaudeCode,
            AgentSettingsProvider::Gemini => Self::Gemini,
            AgentSettingsProvider::OhMyPi => Self::OhMyPi,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum SettingScope {
    User,
    Project,
}

impl SettingScope {
    const fn label(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Project => "project",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum SettingSection {
    General,
    PermissionsSandbox,
    Instructions,
    Environment,
    ProviderSettings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum SettingValueType {
    String,
    Boolean,
    Number,
    StringList,
    StringMap,
    Json,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum SettingControl {
    Text,
    Textarea,
    Toggle,
    Select,
    Number,
    StringList,
    KeyValue,
    Json,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum SettingActivation {
    Immediate,
    NextSession,
    ExplicitRestart,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum NativeConfigFormat {
    Toml,
    Json,
    Jsonc,
    Yaml,
    Dotenv,
    Text,
    Opaque,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum NativeParseStatus {
    Missing,
    Parsed,
    Invalid,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
pub struct SettingKey {
    pub namespace: String,
    pub name: String,
}

impl SettingKey {
    pub fn new(namespace: impl Into<String>, name: impl Into<String>) -> Self {
        Self {
            namespace: namespace.into(),
            name: name.into(),
        }
    }

    pub fn id(&self) -> String {
        format!("{}.{}", self.namespace, self.name)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct SettingOption {
    pub value: Value,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, Default)]
pub struct SettingValidation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minimum: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub maximum: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pattern: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_length: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SettingCapabilities {
    pub readable: bool,
    pub writable: bool,
    pub resettable: bool,
    pub profile_storable: bool,
    pub run_override: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NativeSettingLocation {
    pub file_id: String,
    pub scope: SettingScope,
    pub native_path: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct SettingDescriptor {
    pub key: SettingKey,
    pub section: SettingSection,
    pub label: String,
    pub description: String,
    pub value_type: SettingValueType,
    pub control: SettingControl,
    #[serde(default)]
    pub options: Vec<SettingOption>,
    #[serde(default)]
    pub validation: SettingValidation,
    pub supported_scopes: Vec<SettingScope>,
    pub capabilities: SettingCapabilities,
    pub native_locations: Vec<NativeSettingLocation>,
    pub activation: SettingActivation,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SettingsCapabilities {
    pub readable: bool,
    pub native_writable: bool,
    pub profile_storage: bool,
    pub per_run_overrides: bool,
    pub raw_editable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct NativeConfigFile {
    pub id: String,
    pub path: String,
    pub format: NativeConfigFormat,
    pub scope: SettingScope,
    pub exists: bool,
    pub parse_status: NativeParseStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    pub writable: bool,
    pub raw_editable: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct SettingSourceValue {
    pub source: String,
    pub scope: SettingScope,
    pub file_id: String,
    pub value: Value,
    pub revision: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct EffectiveSetting {
    pub key: SettingKey,
    #[serde(default)]
    pub sources: Vec<SettingSourceValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_value: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effective_source: Option<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct UnknownNativeNode {
    pub file_id: String,
    pub native_path: String,
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentSettingIssue {
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setting_key: Option<String>,
    pub recovery: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct SettingsSnapshot {
    pub provider: AgentSettingsProvider,
    pub installed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executable_path: Option<String>,
    pub schema_revision: String,
    pub capabilities: SettingsCapabilities,
    pub descriptors: Vec<SettingDescriptor>,
    pub native_files: Vec<NativeConfigFile>,
    pub effective_settings: Vec<EffectiveSetting>,
    #[serde(default)]
    pub unknown_native_nodes: Vec<UnknownNativeNode>,
    #[serde(default)]
    pub limitations: Vec<String>,
    #[serde(default)]
    pub errors: Vec<AgentSettingIssue>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct AgentSettingsInventory {
    pub providers: Vec<SettingsSnapshot>,
    #[serde(default)]
    pub errors: Vec<AgentSettingsProviderError>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentSettingsProviderError {
    pub provider: AgentSettingsProvider,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum SettingOperation {
    Set {
        key: SettingKey,
        scope: SettingScope,
        value: Value,
    },
    Unset {
        key: SettingKey,
        scope: SettingScope,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct SettingsPatch {
    pub provider: AgentSettingsProvider,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    pub expected_file_revisions: BTreeMap<String, String>,
    pub operations: Vec<SettingOperation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NativeFileDiff {
    pub file_id: String,
    pub path: String,
    pub before: String,
    pub after: String,
    pub changed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct SettingsDiff {
    pub provider: AgentSettingsProvider,
    pub files: Vec<NativeFileDiff>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ApplySettingsRequest {
    pub patch: SettingsPatch,
    pub confirmed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct NativeFilePatch {
    pub provider: AgentSettingsProvider,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    pub file_id: String,
    pub expected_revision: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct ApplyNativeFileRequest {
    pub patch: NativeFilePatch,
    pub confirmed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ConfigProfile {
    pub id: Uuid,
    pub provider: AgentSettingsProvider,
    pub executor_profile: ExecutorProfileId,
    pub name: String,
    pub schema_version: u16,
    #[serde(default)]
    pub setting_overrides: BTreeMap<String, Value>,
    #[serde(default)]
    pub provider_extensions: BTreeMap<String, Value>,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
    #[serde(default)]
    pub custom_args: Vec<String>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct SaveConfigProfileRequest {
    pub profile: ConfigProfile,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DeleteConfigProfileRequest {
    pub id: Uuid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct DuplicateConfigProfileRequest {
    pub id: Uuid,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct CopyProfilePreviewRequest {
    pub id: Uuid,
    pub target_provider: AgentSettingsProvider,
    pub target_executor_profile: ExecutorProfileId,
    pub target_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ProfileCopyPreview {
    pub profile: ConfigProfile,
    #[serde(default)]
    pub compatible_keys: Vec<String>,
    #[serde(default)]
    pub skipped_keys: Vec<String>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ProfileApplyPreviewRequest {
    pub id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    pub scope: SettingScope,
    pub expected_file_revisions: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ApplyConfigProfileRequest {
    pub preview: ProfileApplyPreviewRequest,
    pub confirmed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(use_ts_enum)]
pub enum AgentSettingErrorCode {
    InvalidRequest,
    InvalidConfiguration,
    NotFound,
    StaleRevision,
    Unsupported,
    UnsafePath,
    ValidationFailed,
    Io,
    RollbackFailed,
    VerificationFailed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AgentSettingOperationError {
    pub code: AgentSettingErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<AgentSettingsProvider>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setting_key: Option<String>,
    pub recovery: String,
}

#[derive(Debug, Error)]
pub enum AgentSettingError {
    #[error("invalid request: {0}")]
    InvalidRequest(String),
    #[error("invalid native configuration: {0}")]
    InvalidConfiguration(String),
    #[error("setting or profile not found: {0}")]
    NotFound(String),
    #[error("native content changed since it was read")]
    StaleRevision,
    #[error("operation is unsupported: {0}")]
    Unsupported(String),
    #[error("unsafe path: {0}")]
    UnsafePath(String),
    #[error("validation failed: {0}")]
    ValidationFailed(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("rollback failed: {0}")]
    RollbackFailed(String),
    #[error("write verification failed: {0}")]
    VerificationFailed(String),
}

impl AgentSettingError {
    pub fn operation_error(
        &self,
        provider: Option<AgentSettingsProvider>,
        file_id: Option<String>,
        setting_key: Option<String>,
    ) -> AgentSettingOperationError {
        let (code, recovery) = match self {
            Self::InvalidRequest(_) => (
                AgentSettingErrorCode::InvalidRequest,
                "Review the request and try again.",
            ),
            Self::InvalidConfiguration(_) => (
                AgentSettingErrorCode::InvalidConfiguration,
                "Fix the native file syntax, then refresh.",
            ),
            Self::NotFound(_) => (
                AgentSettingErrorCode::NotFound,
                "Refresh settings and choose an existing item.",
            ),
            Self::StaleRevision => (
                AgentSettingErrorCode::StaleRevision,
                "Refresh, review the external changes, and retry.",
            ),
            Self::Unsupported(_) => (
                AgentSettingErrorCode::Unsupported,
                "Use a capability supported by this installed provider.",
            ),
            Self::UnsafePath(_) => (
                AgentSettingErrorCode::UnsafePath,
                "Choose a file or project inside the advertised provider roots.",
            ),
            Self::ValidationFailed(_) => (
                AgentSettingErrorCode::ValidationFailed,
                "Correct the highlighted value and preview again.",
            ),
            Self::Io(_) => (
                AgentSettingErrorCode::Io,
                "Check file permissions and retry.",
            ),
            Self::RollbackFailed(_) => (
                AgentSettingErrorCode::RollbackFailed,
                "Inspect the listed native files before retrying.",
            ),
            Self::VerificationFailed(_) => (
                AgentSettingErrorCode::VerificationFailed,
                "Refresh and inspect the provider file before retrying.",
            ),
        };
        AgentSettingOperationError {
            code,
            message: self.to_string(),
            provider,
            file_id,
            setting_key,
            recovery: recovery.to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ConfigProfileStore {
    version: u16,
    #[serde(default)]
    profiles: Vec<ConfigProfile>,
}

impl Default for ConfigProfileStore {
    fn default() -> Self {
        Self {
            version: SETTINGS_PROFILE_STORE_VERSION,
            profiles: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct AgentSettingsService {
    home_dir: PathBuf,
    profile_store_path: PathBuf,
}

impl AgentSettingsService {
    pub fn new(home_dir: PathBuf, profile_store_path: PathBuf) -> Self {
        Self {
            home_dir,
            profile_store_path,
        }
    }

    pub fn from_system() -> Result<Self, AgentSettingError> {
        let home_dir = dirs::home_dir().ok_or_else(|| {
            AgentSettingError::InvalidRequest(
                "could not determine the user home directory".to_string(),
            )
        })?;
        Ok(Self::new(
            home_dir,
            workspace_utils::assets::asset_dir().join("agent-settings/profiles-v1.json"),
        ))
    }

    pub fn manager(
        &self,
        provider: AgentSettingsProvider,
        project_path: Option<&Path>,
    ) -> ProviderSettingsManager {
        DirectProvider::from(provider)
            .settings_manager(self.home_dir.clone(), project_path.map(Path::to_path_buf))
    }

    pub fn discover(
        &self,
        provider: Option<AgentSettingsProvider>,
        project_path: Option<&Path>,
    ) -> AgentSettingsInventory {
        let requested: Vec<_> = provider
            .map(|provider| vec![provider])
            .unwrap_or_else(|| AgentSettingsProvider::ALL.to_vec());
        let mut providers = Vec::new();
        let mut errors = Vec::new();
        for provider in requested {
            match self.manager(provider, project_path).discover() {
                Ok(snapshot) => providers.push(snapshot),
                Err(error) => {
                    errors.push(AgentSettingsProviderError {
                        provider,
                        message: error.to_string(),
                    });
                    providers.push(self.manager(provider, project_path).error_snapshot(&error));
                }
            }
        }
        AgentSettingsInventory { providers, errors }
    }

    pub fn diff(&self, patch: &SettingsPatch) -> Result<SettingsDiff, AgentSettingError> {
        self.manager(patch.provider, patch.project_path.as_deref().map(Path::new))
            .diff(patch)
    }

    pub fn apply(
        &self,
        request: ApplySettingsRequest,
    ) -> Result<SettingsSnapshot, AgentSettingError> {
        if !request.confirmed {
            return Err(AgentSettingError::InvalidRequest(
                "settings apply requires explicit diff confirmation".to_string(),
            ));
        }
        self.manager(
            request.patch.provider,
            request.patch.project_path.as_deref().map(Path::new),
        )
        .apply(&request.patch)
    }

    pub fn diff_native_file(
        &self,
        patch: &NativeFilePatch,
    ) -> Result<SettingsDiff, AgentSettingError> {
        self.manager(patch.provider, patch.project_path.as_deref().map(Path::new))
            .diff_native_file(patch)
    }

    pub fn apply_native_file(
        &self,
        request: ApplyNativeFileRequest,
    ) -> Result<SettingsSnapshot, AgentSettingError> {
        if !request.confirmed {
            return Err(AgentSettingError::InvalidRequest(
                "raw native-file apply requires explicit diff confirmation".to_string(),
            ));
        }
        self.manager(
            request.patch.provider,
            request.patch.project_path.as_deref().map(Path::new),
        )
        .apply_native_file(&request.patch)
    }

    pub fn list_profiles(
        &self,
        provider: Option<AgentSettingsProvider>,
    ) -> Result<Vec<ConfigProfile>, AgentSettingError> {
        let mut profiles = self.load_profile_store()?.profiles;
        if let Some(provider) = provider {
            profiles.retain(|profile| profile.provider == provider);
        }
        profiles.sort_by(|left, right| left.name.cmp(&right.name).then(left.id.cmp(&right.id)));
        Ok(profiles)
    }

    pub fn save_profile(
        &self,
        request: SaveConfigProfileRequest,
    ) -> Result<ConfigProfile, AgentSettingError> {
        let mut profile = request.profile;
        validate_profile(
            &profile,
            &self.manager(profile.provider, None).descriptors(),
        )?;
        profile.schema_version = SETTINGS_PROFILE_STORE_VERSION;
        profile.updated_at = Utc::now();
        let mut store = self.load_profile_store()?;
        if let Some(existing) = store.profiles.iter_mut().find(|item| item.id == profile.id) {
            *existing = profile.clone();
        } else {
            store.profiles.push(profile.clone());
        }
        self.save_profile_store(&store)?;
        Ok(profile)
    }

    pub fn delete_profile(
        &self,
        request: DeleteConfigProfileRequest,
    ) -> Result<(), AgentSettingError> {
        let mut store = self.load_profile_store()?;
        let before = store.profiles.len();
        store.profiles.retain(|profile| profile.id != request.id);
        if before == store.profiles.len() {
            return Err(AgentSettingError::NotFound(request.id.to_string()));
        }
        self.save_profile_store(&store)
    }

    pub fn duplicate_profile(
        &self,
        request: DuplicateConfigProfileRequest,
    ) -> Result<ConfigProfile, AgentSettingError> {
        let store = self.load_profile_store()?;
        let mut profile = store
            .profiles
            .iter()
            .find(|profile| profile.id == request.id)
            .cloned()
            .ok_or_else(|| AgentSettingError::NotFound(request.id.to_string()))?;
        profile.id = Uuid::new_v4();
        profile.name = request.name;
        self.save_profile(SaveConfigProfileRequest { profile })
    }

    pub fn copy_profile_preview(
        &self,
        request: CopyProfilePreviewRequest,
    ) -> Result<ProfileCopyPreview, AgentSettingError> {
        let source = self
            .load_profile_store()?
            .profiles
            .into_iter()
            .find(|profile| profile.id == request.id)
            .ok_or_else(|| AgentSettingError::NotFound(request.id.to_string()))?;
        let target_descriptors = self.manager(request.target_provider, None).descriptors();
        let target_keys: BTreeSet<_> = target_descriptors
            .iter()
            .filter(|descriptor| descriptor.capabilities.profile_storable)
            .map(|descriptor| descriptor.key.id())
            .collect();
        let mut setting_overrides = BTreeMap::new();
        let mut compatible_keys = Vec::new();
        let mut skipped_keys = Vec::new();
        for (key, value) in source.setting_overrides {
            if key.starts_with("common.") && target_keys.contains(&key) {
                compatible_keys.push(key.clone());
                setting_overrides.insert(key, value);
            } else {
                skipped_keys.push(key);
            }
        }
        let warnings = if skipped_keys.is_empty() {
            Vec::new()
        } else {
            vec!["Provider-specific or unsupported settings were skipped; no native extension was copied.".to_string()]
        };
        Ok(ProfileCopyPreview {
            profile: ConfigProfile {
                id: Uuid::new_v4(),
                provider: request.target_provider,
                executor_profile: request.target_executor_profile,
                name: request.target_name,
                schema_version: SETTINGS_PROFILE_STORE_VERSION,
                setting_overrides,
                provider_extensions: BTreeMap::new(),
                environment: source.environment,
                custom_args: source.custom_args,
                updated_at: Utc::now(),
            },
            compatible_keys,
            skipped_keys,
            warnings,
        })
    }

    pub fn preview_profile_apply(
        &self,
        request: &ProfileApplyPreviewRequest,
    ) -> Result<SettingsDiff, AgentSettingError> {
        let profile = self
            .load_profile_store()?
            .profiles
            .into_iter()
            .find(|profile| profile.id == request.id)
            .ok_or_else(|| AgentSettingError::NotFound(request.id.to_string()))?;
        let patch = profile_patch(profile, request);
        self.diff(&patch)
    }

    pub fn apply_profile(
        &self,
        request: ApplyConfigProfileRequest,
    ) -> Result<SettingsSnapshot, AgentSettingError> {
        if !request.confirmed {
            return Err(AgentSettingError::InvalidRequest(
                "profile apply requires explicit diff confirmation".to_string(),
            ));
        }
        let profile = self
            .load_profile_store()?
            .profiles
            .into_iter()
            .find(|profile| profile.id == request.preview.id)
            .ok_or_else(|| AgentSettingError::NotFound(request.preview.id.to_string()))?;
        self.apply(ApplySettingsRequest {
            patch: profile_patch(profile, &request.preview),
            confirmed: true,
        })
    }

    fn load_profile_store(&self) -> Result<ConfigProfileStore, AgentSettingError> {
        let content = match fs::read_to_string(&self.profile_store_path) {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(ConfigProfileStore::default());
            }
            Err(error) => return Err(error.into()),
        };
        let store: ConfigProfileStore = serde_json::from_str(&content).map_err(|error| {
            AgentSettingError::InvalidConfiguration(format!(
                "profile store {}: {error}",
                self.profile_store_path.display()
            ))
        })?;
        if store.version != SETTINGS_PROFILE_STORE_VERSION {
            return Err(AgentSettingError::Unsupported(format!(
                "profile store version {}",
                store.version
            )));
        }
        Ok(store)
    }

    fn save_profile_store(&self, store: &ConfigProfileStore) -> Result<(), AgentSettingError> {
        let content = serde_json::to_vec_pretty(store).map_err(|error| {
            AgentSettingError::InvalidConfiguration(format!("profile serialization: {error}"))
        })?;
        atomic_write(&self.profile_store_path, &content)
    }
}

fn profile_patch(profile: ConfigProfile, request: &ProfileApplyPreviewRequest) -> SettingsPatch {
    SettingsPatch {
        provider: profile.provider,
        project_path: request.project_path.clone(),
        expected_file_revisions: request.expected_file_revisions.clone(),
        operations: profile
            .setting_overrides
            .into_iter()
            .filter_map(|(key, value)| {
                let (namespace, name) = key.split_once('.')?;
                Some(SettingOperation::Set {
                    key: SettingKey::new(namespace, name),
                    scope: request.scope,
                    value,
                })
            })
            .collect(),
    }
}

fn validate_profile(
    profile: &ConfigProfile,
    descriptors: &[SettingDescriptor],
) -> Result<(), AgentSettingError> {
    if profile.name.trim().is_empty() {
        return Err(AgentSettingError::ValidationFailed(
            "profile name cannot be empty".to_string(),
        ));
    }
    let by_key: BTreeMap<_, _> = descriptors
        .iter()
        .map(|descriptor| (descriptor.key.id(), descriptor))
        .collect();
    for (key, value) in &profile.setting_overrides {
        let descriptor = by_key
            .get(key)
            .ok_or_else(|| AgentSettingError::ValidationFailed(format!("unknown setting {key}")))?;
        if !descriptor.capabilities.profile_storable {
            return Err(AgentSettingError::Unsupported(format!(
                "{key} cannot be stored in a profile"
            )));
        }
        validate_setting_value(descriptor, value)?;
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub struct ProviderSettingsManager {
    provider: AgentSettingsProvider,
    home_dir: PathBuf,
    project_path: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct NativeFileSpec {
    id: String,
    path: PathBuf,
    format: NativeConfigFormat,
    scope: SettingScope,
    writable: bool,
    raw_editable: bool,
}

#[derive(Debug, Clone)]
struct ParsedNativeFile {
    spec: NativeFileSpec,
    bytes: Option<Vec<u8>>,
    revision: String,
    content: String,
    value: Option<Value>,
    error: Option<String>,
}

#[derive(Debug, Clone)]
struct RenderedFile {
    spec: NativeFileSpec,
    before: Option<Vec<u8>>,
    after: Vec<u8>,
}

impl ProviderSettingsManager {
    pub fn new(
        provider: AgentSettingsProvider,
        home_dir: PathBuf,
        project_path: Option<PathBuf>,
    ) -> Self {
        let project_path = project_path.map(|path| fs::canonicalize(&path).unwrap_or(path));
        Self {
            provider,
            home_dir,
            project_path,
        }
    }

    pub const fn provider(&self) -> AgentSettingsProvider {
        self.provider
    }

    pub fn descriptors(&self) -> Vec<SettingDescriptor> {
        provider_descriptors(self.provider)
    }

    fn validate_project_path(&self) -> Result<(), AgentSettingError> {
        let Some(project_path) = &self.project_path else {
            return Ok(());
        };
        if !project_path.is_absolute() {
            return Err(AgentSettingError::UnsafePath(
                "project path must be absolute".to_string(),
            ));
        }
        if !project_path.is_dir() {
            return Err(AgentSettingError::UnsafePath(format!(
                "project path does not exist or is not a directory: {}",
                project_path.display()
            )));
        }
        Ok(())
    }

    fn file_specs(&self) -> Vec<NativeFileSpec> {
        let mut files = match self.provider {
            AgentSettingsProvider::Codex => vec![file_spec(
                "user_config",
                self.home_dir.join(".codex/config.toml"),
                NativeConfigFormat::Toml,
                SettingScope::User,
            )],
            AgentSettingsProvider::ClaudeCode => vec![file_spec(
                "user_settings",
                self.home_dir.join(".claude/settings.json"),
                NativeConfigFormat::Json,
                SettingScope::User,
            )],
            AgentSettingsProvider::Gemini => vec![file_spec(
                "user_settings",
                self.home_dir.join(".gemini/settings.json"),
                NativeConfigFormat::Json,
                SettingScope::User,
            )],
            AgentSettingsProvider::OhMyPi => vec![file_spec(
                "user_config",
                self.home_dir.join(".omp/agent/config.yml"),
                NativeConfigFormat::Yaml,
                SettingScope::User,
            )],
        };
        if let Some(project_path) = &self.project_path {
            let spec = match self.provider {
                AgentSettingsProvider::Codex => file_spec(
                    "project_config",
                    project_path.join(".codex/config.toml"),
                    NativeConfigFormat::Toml,
                    SettingScope::Project,
                ),
                AgentSettingsProvider::ClaudeCode => file_spec(
                    "project_settings",
                    project_path.join(".claude/settings.json"),
                    NativeConfigFormat::Json,
                    SettingScope::Project,
                ),
                AgentSettingsProvider::Gemini => file_spec(
                    "project_settings",
                    project_path.join(".gemini/settings.json"),
                    NativeConfigFormat::Json,
                    SettingScope::Project,
                ),
                AgentSettingsProvider::OhMyPi => {
                    let mut spec = file_spec(
                        "project_config",
                        project_path.join(".omp/config.yml"),
                        NativeConfigFormat::Yaml,
                        SettingScope::Project,
                    );
                    // Current OMP project settings support is deliberately
                    // discovery-only until a versioned native setting mapping
                    // is available beyond project model roles.
                    spec.writable = false;
                    spec.raw_editable = false;
                    spec
                }
            };
            files.push(spec);
        }
        files
    }

    pub fn discover(&self) -> Result<SettingsSnapshot, AgentSettingError> {
        self.validate_project_path()?;
        let descriptors = self.descriptors();
        let parsed_files: Vec<_> = self
            .file_specs()
            .into_iter()
            .map(read_native_file)
            .collect();
        let installed = self.provider_root().exists()
            || parsed_files.iter().any(|file| file.bytes.is_some())
            || workspace_utils::shell::resolve_executable_path_blocking(self.provider.executable())
                .is_some();
        let executable_path =
            workspace_utils::shell::resolve_executable_path_blocking(self.provider.executable())
                .map(|path| path.display().to_string());
        let provider_version = DirectProvider::from(self.provider)
            .versions()
            .runtime
            .map(str::to_string);
        let schema_revision =
            revision_bytes(&serde_json::to_vec(&descriptors).map_err(|error| {
                AgentSettingError::InvalidConfiguration(format!(
                    "could not serialize setting descriptors: {error}"
                ))
            })?);

        let mut native_files = Vec::new();
        let mut errors = Vec::new();
        for file in &parsed_files {
            if let Some(error) = &file.error {
                errors.push(AgentSettingIssue {
                    message: error.clone(),
                    file_id: Some(file.spec.id.clone()),
                    setting_key: None,
                    recovery: "Fix this file's syntax or edit it in Advanced, then refresh."
                        .to_string(),
                });
            }
            native_files.push(NativeConfigFile {
                id: file.spec.id.clone(),
                path: file.spec.path.display().to_string(),
                format: file.spec.format,
                scope: file.spec.scope,
                exists: file.bytes.is_some(),
                parse_status: if file.bytes.is_none() {
                    NativeParseStatus::Missing
                } else if file.spec.format == NativeConfigFormat::Opaque {
                    NativeParseStatus::Unsupported
                } else if file.error.is_some() {
                    NativeParseStatus::Invalid
                } else {
                    NativeParseStatus::Parsed
                },
                revision: Some(file.revision.clone()),
                writable: file.spec.writable,
                raw_editable: file.spec.raw_editable,
                raw_content: file
                    .spec
                    .raw_editable
                    .then(|| file.content.clone())
                    .filter(|_| file.bytes.is_some()),
                error: file.error.clone(),
            });
        }

        let effective_settings = descriptors
            .iter()
            .map(|descriptor| effective_setting(descriptor, &parsed_files))
            .collect();
        let unknown_native_nodes = unknown_native_nodes(&descriptors, &parsed_files);

        Ok(SettingsSnapshot {
            provider: self.provider,
            installed,
            provider_version,
            executable_path,
            schema_revision,
            capabilities: SettingsCapabilities {
                readable: true,
                native_writable: descriptors
                    .iter()
                    .any(|descriptor| descriptor.capabilities.writable),
                profile_storage: true,
                per_run_overrides: descriptors
                    .iter()
                    .any(|descriptor| descriptor.capabilities.run_override),
                raw_editable: parsed_files.iter().any(|file| file.spec.raw_editable),
            },
            descriptors,
            native_files,
            effective_settings,
            unknown_native_nodes,
            limitations: provider_limitations(self.provider),
            errors,
        })
    }

    fn error_snapshot(&self, error: &AgentSettingError) -> SettingsSnapshot {
        let descriptors = self.descriptors();
        SettingsSnapshot {
            provider: self.provider,
            installed: false,
            provider_version: None,
            executable_path: None,
            schema_revision: String::new(),
            capabilities: SettingsCapabilities {
                readable: false,
                native_writable: false,
                profile_storage: true,
                per_run_overrides: descriptors
                    .iter()
                    .any(|descriptor| descriptor.capabilities.run_override),
                raw_editable: false,
            },
            descriptors,
            native_files: Vec::new(),
            effective_settings: Vec::new(),
            unknown_native_nodes: Vec::new(),
            limitations: provider_limitations(self.provider),
            errors: vec![AgentSettingIssue {
                message: error.to_string(),
                file_id: None,
                setting_key: None,
                recovery: "Verify the project path and provider configuration, then refresh."
                    .to_string(),
            }],
        }
    }

    pub fn diff(&self, patch: &SettingsPatch) -> Result<SettingsDiff, AgentSettingError> {
        if patch.provider != self.provider {
            return Err(AgentSettingError::InvalidRequest(
                "patch provider does not match settings manager".to_string(),
            ));
        }
        let rendered = self.render_patch(patch)?;
        Ok(SettingsDiff {
            provider: self.provider,
            files: rendered
                .into_iter()
                .map(|file| NativeFileDiff {
                    file_id: file.spec.id,
                    path: file.spec.path.display().to_string(),
                    before: file
                        .before
                        .as_deref()
                        .map(String::from_utf8_lossy)
                        .unwrap_or_default()
                        .into_owned(),
                    after: String::from_utf8_lossy(&file.after).into_owned(),
                    changed: file.before.as_deref() != Some(file.after.as_slice()),
                })
                .collect(),
            warnings: vec![
                "Persistent changes affect new provider sessions; active sessions are not restarted."
                    .to_string(),
            ],
        })
    }

    pub fn apply(&self, patch: &SettingsPatch) -> Result<SettingsSnapshot, AgentSettingError> {
        let rendered = self.render_patch(patch)?;
        write_all_or_restore(&rendered)?;
        match self.discover().and_then(|snapshot| {
            verify_operations(&snapshot, &patch.operations)?;
            Ok(snapshot)
        }) {
            Ok(snapshot) => Ok(snapshot),
            Err(error) => match rollback_files(&rendered) {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(AgentSettingError::RollbackFailed(format!(
                    "apply verification failed: {error}; {rollback_error}"
                ))),
            },
        }
    }

    pub fn diff_native_file(
        &self,
        patch: &NativeFilePatch,
    ) -> Result<SettingsDiff, AgentSettingError> {
        let rendered = self.render_native_file(patch)?;
        Ok(SettingsDiff {
            provider: self.provider,
            files: vec![NativeFileDiff {
                file_id: rendered.spec.id,
                path: rendered.spec.path.display().to_string(),
                before: rendered
                    .before
                    .as_deref()
                    .map(String::from_utf8_lossy)
                    .unwrap_or_default()
                    .into_owned(),
                changed: rendered.before.as_deref() != Some(rendered.after.as_slice()),
                after: String::from_utf8_lossy(&rendered.after).into_owned(),
            }],
            warnings: vec![
                "Raw editing can change provider-native fields that Vibe Kanban does not interpret."
                    .to_string(),
            ],
        })
    }

    pub fn apply_native_file(
        &self,
        patch: &NativeFilePatch,
    ) -> Result<SettingsSnapshot, AgentSettingError> {
        let rendered = self.render_native_file(patch)?;
        write_all_or_restore(std::slice::from_ref(&rendered))?;
        let result = (|| {
            let observed = fs::read(&rendered.spec.path)?;
            if observed != rendered.after {
                return Err(AgentSettingError::VerificationFailed(format!(
                    "{} did not round-trip",
                    rendered.spec.id
                )));
            }
            self.discover()
        })();
        match result {
            Ok(snapshot) => Ok(snapshot),
            Err(error) => match rollback_files(std::slice::from_ref(&rendered)) {
                Ok(()) => Err(error),
                Err(rollback_error) => Err(AgentSettingError::RollbackFailed(format!(
                    "native-file verification failed: {error}; {rollback_error}"
                ))),
            },
        }
    }

    fn render_patch(&self, patch: &SettingsPatch) -> Result<Vec<RenderedFile>, AgentSettingError> {
        self.validate_project_path()?;
        if patch.operations.is_empty() {
            return Err(AgentSettingError::InvalidRequest(
                "settings patch must contain at least one operation".to_string(),
            ));
        }
        let descriptors = self.descriptors();
        let by_key: BTreeMap<_, _> = descriptors
            .iter()
            .map(|descriptor| (descriptor.key.id(), descriptor))
            .collect();
        let specs: BTreeMap<_, _> = self
            .file_specs()
            .into_iter()
            .map(|spec| (spec.id.clone(), spec))
            .collect();
        let mut file_operations: BTreeMap<String, Vec<&SettingOperation>> = BTreeMap::new();
        for operation in &patch.operations {
            let (key, scope, value) = match operation {
                SettingOperation::Set { key, scope, value } => (key, *scope, Some(value)),
                SettingOperation::Unset { key, scope } => (key, *scope, None),
            };
            let key_id = key.id();
            let descriptor = by_key.get(&key_id).ok_or_else(|| {
                AgentSettingError::ValidationFailed(format!("unknown setting {key_id}"))
            })?;
            if !descriptor.capabilities.writable {
                return Err(AgentSettingError::Unsupported(format!(
                    "{key_id} is read-only"
                )));
            }
            if value.is_none() && !descriptor.capabilities.resettable {
                return Err(AgentSettingError::Unsupported(format!(
                    "{key_id} cannot be reset"
                )));
            }
            if let Some(value) = value {
                validate_setting_value(descriptor, value)?;
            }
            let location = descriptor
                .native_locations
                .iter()
                .find(|location| location.scope == scope)
                .ok_or_else(|| {
                    AgentSettingError::Unsupported(format!(
                        "{key_id} is not writable at {} scope",
                        scope.label()
                    ))
                })?;
            file_operations
                .entry(location.file_id.clone())
                .or_default()
                .push(operation);
        }

        let mut rendered = Vec::new();
        for (file_id, operations) in file_operations {
            let spec = specs
                .get(&file_id)
                .cloned()
                .ok_or_else(|| AgentSettingError::NotFound(file_id.clone()))?;
            if !spec.writable {
                return Err(AgentSettingError::Unsupported(format!(
                    "{} is discovery-only",
                    spec.id
                )));
            }
            let parsed = read_native_file(spec.clone());
            require_expected_revision(&patch.expected_file_revisions, &spec.id, &parsed.revision)?;
            if let Some(error) = parsed.error {
                return Err(AgentSettingError::InvalidConfiguration(format!(
                    "{}: {error}",
                    spec.path.display()
                )));
            }
            let after = render_document(
                spec.format,
                &parsed.content,
                operations.into_iter().map(|operation| {
                    let (key, scope, value) = match operation {
                        SettingOperation::Set { key, scope, value } => {
                            (key, *scope, Some(value.clone()))
                        }
                        SettingOperation::Unset { key, scope } => (key, *scope, None),
                    };
                    let descriptor = by_key
                        .get(&key.id())
                        .expect("validated descriptor remains available");
                    let path = descriptor
                        .native_locations
                        .iter()
                        .find(|location| location.scope == scope)
                        .expect("validated location remains available")
                        .native_path
                        .clone();
                    (path, value)
                }),
            )?;
            rendered.push(RenderedFile {
                spec,
                before: parsed.bytes,
                after: after.into_bytes(),
            });
        }
        Ok(rendered)
    }

    fn render_native_file(
        &self,
        patch: &NativeFilePatch,
    ) -> Result<RenderedFile, AgentSettingError> {
        self.validate_project_path()?;
        if patch.provider != self.provider {
            return Err(AgentSettingError::InvalidRequest(
                "native patch provider does not match settings manager".to_string(),
            ));
        }
        let spec = self
            .file_specs()
            .into_iter()
            .find(|spec| spec.id == patch.file_id)
            .ok_or_else(|| AgentSettingError::NotFound(patch.file_id.clone()))?;
        if !spec.raw_editable {
            return Err(AgentSettingError::Unsupported(format!(
                "{} does not support raw text editing",
                spec.id
            )));
        }
        let parsed = read_native_file(spec.clone());
        if parsed.bytes.is_none() {
            return Err(AgentSettingError::NotFound(format!(
                "{} does not exist",
                spec.path.display()
            )));
        }
        if parsed.revision != patch.expected_revision {
            return Err(AgentSettingError::StaleRevision);
        }
        parse_document(spec.format, &patch.content)?;
        Ok(RenderedFile {
            spec,
            before: parsed.bytes,
            after: patch.content.as_bytes().to_vec(),
        })
    }

    fn provider_root(&self) -> PathBuf {
        match self.provider {
            AgentSettingsProvider::Codex => self.home_dir.join(".codex"),
            AgentSettingsProvider::ClaudeCode => self.home_dir.join(".claude"),
            AgentSettingsProvider::Gemini => self.home_dir.join(".gemini"),
            AgentSettingsProvider::OhMyPi => self.home_dir.join(".omp"),
        }
    }
}

fn file_spec(
    id: &str,
    path: PathBuf,
    format: NativeConfigFormat,
    scope: SettingScope,
) -> NativeFileSpec {
    NativeFileSpec {
        id: id.to_string(),
        path,
        format,
        scope,
        writable: true,
        raw_editable: !matches!(format, NativeConfigFormat::Opaque),
    }
}

fn provider_descriptors(provider: AgentSettingsProvider) -> Vec<SettingDescriptor> {
    match provider {
        AgentSettingsProvider::Codex => codex_descriptors(),
        AgentSettingsProvider::ClaudeCode => claude_descriptors(),
        AgentSettingsProvider::Gemini => gemini_descriptors(),
        AgentSettingsProvider::OhMyPi => oh_my_pi_descriptors(),
    }
}

fn descriptor(
    namespace: &str,
    name: &str,
    section: SettingSection,
    label: &str,
    description: &str,
    value_type: SettingValueType,
    control: SettingControl,
    locations: &[(&str, SettingScope, &[&str])],
    run_override: bool,
) -> SettingDescriptor {
    SettingDescriptor {
        key: SettingKey::new(namespace, name),
        section,
        label: label.to_string(),
        description: description.to_string(),
        value_type,
        control,
        options: Vec::new(),
        validation: SettingValidation::default(),
        supported_scopes: locations.iter().map(|(_, scope, _)| *scope).collect(),
        capabilities: SettingCapabilities {
            readable: true,
            writable: !locations.is_empty(),
            resettable: !locations.is_empty(),
            profile_storable: !locations.is_empty(),
            run_override,
        },
        native_locations: locations
            .iter()
            .map(|(file_id, scope, path)| NativeSettingLocation {
                file_id: (*file_id).to_string(),
                scope: *scope,
                native_path: path.iter().map(|segment| (*segment).to_string()).collect(),
            })
            .collect(),
        activation: SettingActivation::NextSession,
    }
}

fn common_locations<'a>(path: &'a [&'a str]) -> [(&'a str, SettingScope, &'a [&'a str]); 2] {
    [
        ("user_config", SettingScope::User, path),
        ("project_config", SettingScope::Project, path),
    ]
}

fn common_settings_locations<'a>(
    path: &'a [&'a str],
) -> [(&'a str, SettingScope, &'a [&'a str]); 2] {
    [
        ("user_settings", SettingScope::User, path),
        ("project_settings", SettingScope::Project, path),
    ]
}

fn select_options(mut descriptor: SettingDescriptor, values: &[(&str, &str)]) -> SettingDescriptor {
    descriptor.options = values
        .iter()
        .map(|(value, label)| SettingOption {
            value: Value::String((*value).to_string()),
            label: (*label).to_string(),
            description: None,
        })
        .collect();
    descriptor
}

fn codex_descriptors() -> Vec<SettingDescriptor> {
    vec![
        descriptor(
            "common",
            "model",
            SettingSection::General,
            "Model",
            "Default model used by new Codex sessions.",
            SettingValueType::String,
            SettingControl::Text,
            &common_locations(&["model"]),
            true,
        ),
        select_options(
            descriptor(
                "common",
                "reasoning",
                SettingSection::General,
                "Reasoning effort",
                "Default model reasoning effort.",
                SettingValueType::String,
                SettingControl::Select,
                &common_locations(&["model_reasoning_effort"]),
                true,
            ),
            &[
                ("minimal", "Minimal"),
                ("low", "Low"),
                ("medium", "Medium"),
                ("high", "High"),
                ("xhigh", "Extra high"),
            ],
        ),
        select_options(
            descriptor(
                "common",
                "approval_policy",
                SettingSection::PermissionsSandbox,
                "Approval policy",
                "When Codex asks before running commands.",
                SettingValueType::String,
                SettingControl::Select,
                &common_locations(&["approval_policy"]),
                true,
            ),
            &[
                ("untrusted", "Untrusted"),
                ("on-request", "On request"),
                ("never", "Never"),
            ],
        ),
        select_options(
            descriptor(
                "common",
                "sandbox_mode",
                SettingSection::PermissionsSandbox,
                "Sandbox mode",
                "Filesystem and process isolation used by new sessions.",
                SettingValueType::String,
                SettingControl::Select,
                &common_locations(&["sandbox_mode"]),
                false,
            ),
            &[
                ("read-only", "Read only"),
                ("workspace-write", "Workspace write"),
                ("danger-full-access", "Full access"),
            ],
        ),
        descriptor(
            "codex",
            "web_search",
            SettingSection::ProviderSettings,
            "Web search",
            "Enable Codex's documented web search feature flag.",
            SettingValueType::Boolean,
            SettingControl::Toggle,
            &common_locations(&["features", "web_search"]),
            false,
        ),
        descriptor(
            "common",
            "environment",
            SettingSection::Environment,
            "Environment variables",
            "Exact environment values injected by Codex's shell environment policy.",
            SettingValueType::StringMap,
            SettingControl::KeyValue,
            &common_locations(&["shell_environment_policy", "set"]),
            true,
        ),
    ]
}

fn claude_descriptors() -> Vec<SettingDescriptor> {
    vec![
        descriptor(
            "common",
            "model",
            SettingSection::General,
            "Model",
            "Default model used by new Claude Code sessions.",
            SettingValueType::String,
            SettingControl::Text,
            &common_settings_locations(&["model"]),
            true,
        ),
        select_options(
            descriptor(
                "common",
                "reasoning",
                SettingSection::General,
                "Effort",
                "Claude Code effort level when supported by the installed version.",
                SettingValueType::String,
                SettingControl::Select,
                &common_settings_locations(&["effortLevel"]),
                true,
            ),
            &[("low", "Low"), ("medium", "Medium"), ("high", "High")],
        ),
        select_options(
            descriptor(
                "common",
                "permission_mode",
                SettingSection::PermissionsSandbox,
                "Permission mode",
                "Default Claude Code permission mode.",
                SettingValueType::String,
                SettingControl::Select,
                &common_settings_locations(&["permissions", "defaultMode"]),
                true,
            ),
            &[
                ("default", "Default"),
                ("acceptEdits", "Accept edits"),
                ("plan", "Plan"),
                ("dontAsk", "Don't ask"),
                ("bypassPermissions", "Bypass permissions"),
            ],
        ),
        descriptor(
            "claude_code",
            "permission_allow",
            SettingSection::PermissionsSandbox,
            "Allowed tools",
            "Native Claude Code allow rules.",
            SettingValueType::StringList,
            SettingControl::StringList,
            &common_settings_locations(&["permissions", "allow"]),
            false,
        ),
        descriptor(
            "claude_code",
            "permission_deny",
            SettingSection::PermissionsSandbox,
            "Denied tools",
            "Native Claude Code deny rules.",
            SettingValueType::StringList,
            SettingControl::StringList,
            &common_settings_locations(&["permissions", "deny"]),
            false,
        ),
        descriptor(
            "common",
            "environment",
            SettingSection::Environment,
            "Environment variables",
            "Exact environment values set for Claude Code sessions.",
            SettingValueType::StringMap,
            SettingControl::KeyValue,
            &common_settings_locations(&["env"]),
            true,
        ),
        descriptor(
            "claude_code",
            "output_style",
            SettingSection::ProviderSettings,
            "Output style",
            "Named Claude Code output style.",
            SettingValueType::String,
            SettingControl::Text,
            &common_settings_locations(&["outputStyle"]),
            false,
        ),
        descriptor(
            "claude_code",
            "enabled_plugins",
            SettingSection::ProviderSettings,
            "Enabled plugins",
            "Native plugin enablement map.",
            SettingValueType::StringMap,
            SettingControl::KeyValue,
            &common_settings_locations(&["enabledPlugins"]),
            false,
        ),
        descriptor(
            "claude_code",
            "hooks",
            SettingSection::ProviderSettings,
            "Hooks",
            "Claude Code hook definitions. Advanced JSON preserves provider-specific shapes.",
            SettingValueType::Json,
            SettingControl::Json,
            &common_settings_locations(&["hooks"]),
            false,
        ),
        descriptor(
            "claude_code",
            "status_line",
            SettingSection::ProviderSettings,
            "Status line",
            "Claude Code status-line configuration.",
            SettingValueType::Json,
            SettingControl::Json,
            &common_settings_locations(&["statusLine"]),
            false,
        ),
    ]
}

fn gemini_descriptors() -> Vec<SettingDescriptor> {
    vec![
        descriptor(
            "common",
            "model",
            SettingSection::General,
            "Model",
            "Default model used by new Gemini sessions.",
            SettingValueType::String,
            SettingControl::Text,
            &common_settings_locations(&["model", "name"]),
            true,
        ),
        descriptor(
            "common",
            "sandbox_enabled",
            SettingSection::PermissionsSandbox,
            "Sandbox",
            "Run Gemini tools in its native sandbox.",
            SettingValueType::Boolean,
            SettingControl::Toggle,
            &common_settings_locations(&["tools", "sandbox"]),
            false,
        ),
        descriptor(
            "gemini",
            "allowed_tools",
            SettingSection::PermissionsSandbox,
            "Allowed tools",
            "Native Gemini tool allow policy.",
            SettingValueType::StringList,
            SettingControl::StringList,
            &common_settings_locations(&["tools", "allowed"]),
            false,
        ),
        descriptor(
            "gemini",
            "excluded_tools",
            SettingSection::PermissionsSandbox,
            "Excluded tools",
            "Native Gemini tool exclusion policy.",
            SettingValueType::StringList,
            SettingControl::StringList,
            &common_settings_locations(&["tools", "exclude"]),
            false,
        ),
        descriptor(
            "gemini",
            "checkpointing",
            SettingSection::ProviderSettings,
            "Checkpointing",
            "Enable Gemini checkpointing when supported.",
            SettingValueType::Boolean,
            SettingControl::Toggle,
            &common_settings_locations(&["general", "checkpointing", "enabled"]),
            false,
        ),
        descriptor(
            "gemini",
            "telemetry",
            SettingSection::ProviderSettings,
            "Telemetry",
            "Enable Gemini CLI telemetry.",
            SettingValueType::Boolean,
            SettingControl::Toggle,
            &common_settings_locations(&["telemetry", "enabled"]),
            false,
        ),
    ]
}

fn oh_my_pi_descriptors() -> Vec<SettingDescriptor> {
    let user = |path: &'static [&'static str]| [("user_config", SettingScope::User, path)];
    vec![
        descriptor(
            "oh_my_pi",
            "extensions",
            SettingSection::ProviderSettings,
            "Extensions",
            "OMP extension packages loaded by the canonical agent profile.",
            SettingValueType::StringList,
            SettingControl::StringList,
            &user(&["extensions"]),
            false,
        ),
        descriptor(
            "oh_my_pi",
            "disabled_extensions",
            SettingSection::ProviderSettings,
            "Disabled extensions",
            "OMP extensions retained but disabled.",
            SettingValueType::StringList,
            SettingControl::StringList,
            &user(&["disabledExtensions"]),
            false,
        ),
        descriptor(
            "oh_my_pi",
            "dark_theme",
            SettingSection::ProviderSettings,
            "Dark theme",
            "OMP dark-mode theme identifier.",
            SettingValueType::String,
            SettingControl::Text,
            &user(&["theme", "dark"]),
            false,
        ),
        descriptor(
            "oh_my_pi",
            "light_theme",
            SettingSection::ProviderSettings,
            "Light theme",
            "OMP light-mode theme identifier.",
            SettingValueType::String,
            SettingControl::Text,
            &user(&["theme", "light"]),
            false,
        ),
        descriptor(
            "oh_my_pi",
            "compaction_enabled",
            SettingSection::ProviderSettings,
            "Compaction",
            "Enable OMP context compaction.",
            SettingValueType::Boolean,
            SettingControl::Toggle,
            &user(&["compaction", "enabled"]),
            false,
        ),
        descriptor(
            "oh_my_pi",
            "startup_quiet",
            SettingSection::General,
            "Quiet startup",
            "Reduce OMP startup output.",
            SettingValueType::Boolean,
            SettingControl::Toggle,
            &user(&["startup", "quiet"]),
            false,
        ),
    ]
}

fn provider_limitations(provider: AgentSettingsProvider) -> Vec<String> {
    match provider {
        AgentSettingsProvider::Codex => vec![
            "Native profiles and per-project trust entries remain available through raw TOML until their installed-version schema can be verified.".to_string(),
        ],
        AgentSettingsProvider::ClaudeCode => vec![
            "Managed settings use ~/.claude/settings.json and project .claude/settings.json; ~/.claude.json authentication and MCP state is not edited here.".to_string(),
        ],
        AgentSettingsProvider::Gemini => vec![
            "Extensions and version-dependent policy nodes remain native-only and are preserved by targeted writes.".to_string(),
        ],
        AgentSettingsProvider::OhMyPi => vec![
            "Management targets the canonical ~/.omp/agent/config.yml profile; project config and alternate profiles are discovery-only.".to_string(),
            "Model registry and prompt-template files are reported as native extensions rather than guessed into config.yml fields.".to_string(),
        ],
    }
}

fn read_native_file(spec: NativeFileSpec) -> ParsedNativeFile {
    let bytes = match fs::read(&spec.path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return ParsedNativeFile {
                spec,
                bytes: None,
                revision: "unreadable".to_string(),
                content: String::new(),
                value: None,
                error: Some(error.to_string()),
            };
        }
    };
    let revision = bytes
        .as_deref()
        .map(revision_bytes)
        .unwrap_or_else(|| "missing".to_string());
    let content = bytes
        .as_deref()
        .map(String::from_utf8_lossy)
        .unwrap_or_default()
        .into_owned();
    let parsed = if bytes.is_some() {
        parse_document(spec.format, &content)
    } else {
        Ok(Value::Object(Map::new()))
    };
    let (value, error) = match parsed {
        Ok(value) => (Some(value), None),
        Err(error) => (None, Some(error.to_string())),
    };
    ParsedNativeFile {
        spec,
        bytes,
        revision,
        content,
        value,
        error,
    }
}

fn parse_document(format: NativeConfigFormat, content: &str) -> Result<Value, AgentSettingError> {
    if content.trim().is_empty() {
        return Ok(Value::Object(Map::new()));
    }
    match format {
        NativeConfigFormat::Toml => {
            let value: toml::Value = toml::from_str(content).map_err(|error| {
                AgentSettingError::InvalidConfiguration(format!("TOML syntax: {error}"))
            })?;
            serde_json::to_value(value).map_err(|error| {
                AgentSettingError::InvalidConfiguration(format!("TOML conversion: {error}"))
            })
        }
        NativeConfigFormat::Json => serde_json::from_str(content).map_err(|error| {
            AgentSettingError::InvalidConfiguration(format!("JSON syntax: {error}"))
        }),
        NativeConfigFormat::Jsonc => {
            jsonc_parser::parse_to_serde_value(content, &ParseOptions::default())
                .map_err(|error| {
                    AgentSettingError::InvalidConfiguration(format!("JSONC syntax: {error}"))
                })?
                .ok_or_else(|| {
                    AgentSettingError::InvalidConfiguration("empty JSONC document".to_string())
                })
        }
        NativeConfigFormat::Yaml => {
            let value: serde_yaml::Value = serde_yaml::from_str(content).map_err(|error| {
                AgentSettingError::InvalidConfiguration(format!("YAML syntax: {error}"))
            })?;
            serde_json::to_value(value).map_err(|error| {
                AgentSettingError::InvalidConfiguration(format!("YAML conversion: {error}"))
            })
        }
        NativeConfigFormat::Dotenv => parse_dotenv(content),
        NativeConfigFormat::Text => Ok(Value::String(content.to_string())),
        NativeConfigFormat::Opaque => Err(AgentSettingError::Unsupported(
            "opaque provider state cannot be parsed as text".to_string(),
        )),
    }
}

fn parse_dotenv(content: &str) -> Result<Value, AgentSettingError> {
    let mut output = Map::new();
    for (index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let (key, value) = trimmed.split_once('=').ok_or_else(|| {
            AgentSettingError::InvalidConfiguration(format!("dotenv line {} has no '='", index + 1))
        })?;
        if key.trim().is_empty() {
            return Err(AgentSettingError::InvalidConfiguration(format!(
                "dotenv line {} has an empty key",
                index + 1
            )));
        }
        output.insert(key.trim().to_string(), Value::String(value.to_string()));
    }
    Ok(Value::Object(output))
}

fn render_document(
    format: NativeConfigFormat,
    current: &str,
    operations: impl IntoIterator<Item = (Vec<String>, Option<Value>)>,
) -> Result<String, AgentSettingError> {
    let operations: Vec<_> = operations.into_iter().collect();
    match format {
        NativeConfigFormat::Toml => render_toml(current, &operations),
        NativeConfigFormat::Json | NativeConfigFormat::Jsonc => {
            let mut value = parse_document(format, current)?;
            ensure_object_root(&mut value)?;
            for (path, replacement) in &operations {
                update_json_path(&mut value, path, replacement.clone())?;
            }
            if format == NativeConfigFormat::Jsonc {
                Ok(update_jsonc_content(current, &value))
            } else {
                serde_json::to_string_pretty(&value).map_err(|error| {
                    AgentSettingError::InvalidConfiguration(format!("JSON serialization: {error}"))
                })
            }
        }
        NativeConfigFormat::Yaml => {
            let mut value = parse_document(format, current)?;
            ensure_object_root(&mut value)?;
            for (path, replacement) in &operations {
                update_json_path(&mut value, path, replacement.clone())?;
            }
            serde_yaml::to_string(&json_to_yaml(&value)?).map_err(|error| {
                AgentSettingError::InvalidConfiguration(format!("YAML serialization: {error}"))
            })
        }
        NativeConfigFormat::Dotenv => {
            let mut value = parse_dotenv(current)?;
            for (path, replacement) in &operations {
                if path.len() != 1 {
                    return Err(AgentSettingError::Unsupported(
                        "dotenv settings must use one path segment".to_string(),
                    ));
                }
                update_json_path(&mut value, path, replacement.clone())?;
            }
            let object = value.as_object().expect("dotenv parser returns object");
            Ok(object
                .iter()
                .map(|(key, value)| format!("{key}={}", value.as_str().unwrap_or_default()))
                .collect::<Vec<_>>()
                .join("\n"))
        }
        NativeConfigFormat::Text | NativeConfigFormat::Opaque => Err(
            AgentSettingError::Unsupported("typed edits are not supported for this format".into()),
        ),
    }
}

fn render_toml(
    current: &str,
    operations: &[(Vec<String>, Option<Value>)],
) -> Result<String, AgentSettingError> {
    let mut document = if current.trim().is_empty() {
        DocumentMut::new()
    } else {
        current.parse::<DocumentMut>().map_err(|error| {
            AgentSettingError::InvalidConfiguration(format!("TOML syntax: {error}"))
        })?
    };
    for (path, replacement) in operations {
        if path.is_empty() {
            return Err(AgentSettingError::InvalidRequest(
                "native setting path cannot be empty".to_string(),
            ));
        }
        let (parents, leaf) = path.split_at(path.len() - 1);
        let mut table = document.as_table_mut();
        for segment in parents {
            if !table.contains_key(segment) {
                table.insert(segment, Item::Table(toml_edit::Table::new()));
            }
            table = table
                .get_mut(segment)
                .and_then(Item::as_table_mut)
                .ok_or_else(|| {
                    AgentSettingError::InvalidConfiguration(format!(
                        "{} must be a TOML table",
                        parents.join(".")
                    ))
                })?;
        }
        if let Some(replacement) = replacement {
            let mut value = replacement
                .serialize(toml_edit::ser::ValueSerializer::new())
                .map_err(|error| {
                    AgentSettingError::ValidationFailed(format!(
                        "{} cannot be represented in TOML: {error}",
                        path.join(".")
                    ))
                })?;
            if let Some(existing) = table.get_mut(&leaf[0]) {
                let existing_value = existing.as_value_mut().ok_or_else(|| {
                    AgentSettingError::InvalidConfiguration(format!(
                        "{} has a TOML table where a value is required",
                        path.join(".")
                    ))
                })?;
                // Mutate the Item in place so comments attached to its TOML
                // key remain intact. Re-inserting the key discards that CST
                // decoration even if the value decoration is copied.
                *value.decor_mut() = existing_value.decor().clone();
                *existing_value = value;
            } else {
                table.insert(&leaf[0], Item::Value(value));
            }
        } else {
            table.remove(&leaf[0]);
        }
    }
    let rendered = document.to_string();
    parse_document(NativeConfigFormat::Toml, &rendered)?;
    Ok(rendered)
}

fn json_to_yaml(value: &Value) -> Result<serde_yaml::Value, AgentSettingError> {
    Ok(match value {
        Value::Null => serde_yaml::Value::Null,
        Value::Bool(value) => serde_yaml::Value::Bool(*value),
        Value::Number(value) => {
            let number = if let Some(value) = value.as_i64() {
                serde_yaml::Number::from(value)
            } else if let Some(value) = value.as_u64() {
                serde_yaml::Number::from(value)
            } else if let Some(value) = value.as_f64() {
                serde_yaml::Number::from(value)
            } else {
                return Err(AgentSettingError::ValidationFailed(
                    "number cannot be represented in YAML".to_string(),
                ));
            };
            serde_yaml::Value::Number(number)
        }
        Value::String(value) => serde_yaml::Value::String(value.clone()),
        Value::Array(values) => serde_yaml::Value::Sequence(
            values
                .iter()
                .map(json_to_yaml)
                .collect::<Result<Vec<_>, _>>()?,
        ),
        Value::Object(object) => serde_yaml::Value::Mapping(
            object
                .iter()
                .map(|(key, value)| {
                    Ok((serde_yaml::Value::String(key.clone()), json_to_yaml(value)?))
                })
                .collect::<Result<serde_yaml::Mapping, AgentSettingError>>()?,
        ),
    })
}

fn ensure_object_root(value: &mut Value) -> Result<(), AgentSettingError> {
    if value.is_null() {
        *value = Value::Object(Map::new());
    }
    if !value.is_object() {
        return Err(AgentSettingError::InvalidConfiguration(
            "native configuration root must be an object".to_string(),
        ));
    }
    Ok(())
}

fn update_json_path(
    root: &mut Value,
    path: &[String],
    replacement: Option<Value>,
) -> Result<(), AgentSettingError> {
    if path.is_empty() {
        return Err(AgentSettingError::InvalidRequest(
            "native setting path cannot be empty".to_string(),
        ));
    }
    let mut current = root;
    for segment in &path[..path.len() - 1] {
        let object = current.as_object_mut().ok_or_else(|| {
            AgentSettingError::InvalidConfiguration(format!("{} must be an object", path.join(".")))
        })?;
        current = object
            .entry(segment.clone())
            .or_insert_with(|| Value::Object(Map::new()));
    }
    let object = current.as_object_mut().ok_or_else(|| {
        AgentSettingError::InvalidConfiguration(format!(
            "{} parent must be an object",
            path.join(".")
        ))
    })?;
    if let Some(replacement) = replacement {
        object.insert(path[path.len() - 1].clone(), replacement);
    } else {
        object.remove(&path[path.len() - 1]);
    }
    Ok(())
}

fn value_at_path<'a>(value: &'a Value, path: &[String]) -> Option<&'a Value> {
    path.iter()
        .try_fold(value, |current, segment| current.get(segment))
}

fn effective_setting(
    descriptor: &SettingDescriptor,
    files: &[ParsedNativeFile],
) -> EffectiveSetting {
    let mut sources = Vec::new();
    let mut warnings = Vec::new();
    for location in &descriptor.native_locations {
        let Some(file) = files.iter().find(|file| file.spec.id == location.file_id) else {
            continue;
        };
        if file.error.is_some() {
            warnings.push(format!(
                "{} could not be read from {}",
                descriptor.key.id(),
                file.spec.id
            ));
            continue;
        }
        if let Some(value) = file
            .value
            .as_ref()
            .and_then(|value| value_at_path(value, &location.native_path))
        {
            sources.push(SettingSourceValue {
                source: format!("native_{}", location.scope.label()),
                scope: location.scope,
                file_id: file.spec.id.clone(),
                value: value.clone(),
                revision: file.revision.clone(),
            });
        }
    }
    // Location order is provider-owned and intentionally encodes effective
    // precedence. Current Codex/Claude/Gemini descriptors list user then
    // project; OMP exposes only verified user-writable settings.
    let effective = sources.last();
    EffectiveSetting {
        key: descriptor.key.clone(),
        effective_value: effective.map(|source| source.value.clone()),
        effective_source: effective.map(|source| source.source.clone()),
        sources,
        warnings,
    }
}

fn unknown_native_nodes(
    descriptors: &[SettingDescriptor],
    files: &[ParsedNativeFile],
) -> Vec<UnknownNativeNode> {
    let known: BTreeSet<_> = descriptors
        .iter()
        .flat_map(|descriptor| descriptor.native_locations.iter())
        .map(|location| (location.file_id.clone(), location.native_path.join(".")))
        .collect();
    let mut output = Vec::new();
    for file in files {
        let Some(value) = &file.value else {
            continue;
        };
        let mut leaves = Vec::new();
        collect_leaf_nodes(value, String::new(), &mut leaves);
        for (path, value) in leaves {
            let managed = known.iter().any(|(file_id, known_path)| {
                file_id == &file.spec.id
                    && (path == *known_path || path.starts_with(&format!("{known_path}.")))
            });
            if !managed {
                output.push(UnknownNativeNode {
                    file_id: file.spec.id.clone(),
                    native_path: path,
                    value,
                });
            }
        }
    }
    output
}

fn collect_leaf_nodes(value: &Value, prefix: String, output: &mut Vec<(String, Value)>) {
    match value {
        Value::Object(object) if !object.is_empty() => {
            for (key, value) in object {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                collect_leaf_nodes(value, path, output);
            }
        }
        _ if !prefix.is_empty() => output.push((prefix, value.clone())),
        _ => {}
    }
}

fn validate_setting_value(
    descriptor: &SettingDescriptor,
    value: &Value,
) -> Result<(), AgentSettingError> {
    let type_matches = match descriptor.value_type {
        SettingValueType::String => value.is_string(),
        SettingValueType::Boolean => value.is_boolean(),
        SettingValueType::Number => value.is_number(),
        SettingValueType::StringList => value
            .as_array()
            .is_some_and(|values| values.iter().all(Value::is_string)),
        SettingValueType::StringMap => value
            .as_object()
            .is_some_and(|values| values.values().all(Value::is_string)),
        SettingValueType::Json => true,
    };
    if !type_matches {
        return Err(AgentSettingError::ValidationFailed(format!(
            "{} expects {:?}",
            descriptor.key.id(),
            descriptor.value_type
        )));
    }
    if !descriptor.options.is_empty()
        && !descriptor
            .options
            .iter()
            .any(|option| option.value == *value)
    {
        return Err(AgentSettingError::ValidationFailed(format!(
            "{} is not one of the advertised options",
            descriptor.key.id()
        )));
    }
    if let Some(string) = value.as_str()
        && let Some(max_length) = descriptor.validation.max_length
        && string.chars().count() > max_length as usize
    {
        return Err(AgentSettingError::ValidationFailed(format!(
            "{} exceeds {max_length} characters",
            descriptor.key.id()
        )));
    }
    if let Some(number) = value.as_f64() {
        if descriptor
            .validation
            .minimum
            .is_some_and(|minimum| number < minimum)
        {
            return Err(AgentSettingError::ValidationFailed(format!(
                "{} is below its minimum",
                descriptor.key.id()
            )));
        }
        if descriptor
            .validation
            .maximum
            .is_some_and(|maximum| number > maximum)
        {
            return Err(AgentSettingError::ValidationFailed(format!(
                "{} exceeds its maximum",
                descriptor.key.id()
            )));
        }
    }
    Ok(())
}

fn require_expected_revision(
    expected: &BTreeMap<String, String>,
    file_id: &str,
    current: &str,
) -> Result<(), AgentSettingError> {
    let expected = expected.get(file_id).ok_or_else(|| {
        AgentSettingError::InvalidRequest(format!(
            "mutation requires the observed revision for {file_id}"
        ))
    })?;
    if expected != current {
        return Err(AgentSettingError::StaleRevision);
    }
    Ok(())
}

fn verify_operations(
    snapshot: &SettingsSnapshot,
    operations: &[SettingOperation],
) -> Result<(), AgentSettingError> {
    for operation in operations {
        let (key, scope, expected) = match operation {
            SettingOperation::Set { key, scope, value } => (key, scope, Some(value)),
            SettingOperation::Unset { key, scope } => (key, scope, None),
        };
        let observed = snapshot
            .effective_settings
            .iter()
            .find(|setting| setting.key == *key)
            .and_then(|setting| setting.sources.iter().find(|source| source.scope == *scope));
        let matches = match expected {
            Some(expected) => observed.is_some_and(|source| source.value == *expected),
            None => observed.is_none(),
        };
        if !matches {
            return Err(AgentSettingError::VerificationFailed(format!(
                "{} did not round-trip at {} scope",
                key.id(),
                scope.label()
            )));
        }
    }
    Ok(())
}

fn write_all_or_restore(files: &[RenderedFile]) -> Result<(), AgentSettingError> {
    let mut written = Vec::new();
    for file in files {
        if file.before.as_deref() == Some(file.after.as_slice()) {
            continue;
        }
        if let Err(error) = atomic_write(&file.spec.path, &file.after) {
            if let Err(rollback_error) = rollback_files(&written) {
                return Err(AgentSettingError::RollbackFailed(format!(
                    "write failed: {error}; {rollback_error}"
                )));
            }
            return Err(error);
        }
        written.push(file.clone());
    }
    Ok(())
}

fn rollback_files(files: &[RenderedFile]) -> Result<(), AgentSettingError> {
    let mut errors = Vec::new();
    for file in files.iter().rev() {
        let result = if let Some(before) = &file.before {
            atomic_write(&file.spec.path, before)
        } else {
            match fs::remove_file(&file.spec.path) {
                Ok(()) => Ok(()),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error.into()),
            }
        };
        if let Err(error) = result {
            errors.push(format!("{}: {error}", file.spec.path.display()));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(AgentSettingError::RollbackFailed(errors.join("; ")))
    }
}

fn revision_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), AgentSettingError> {
    let parent = path.parent().ok_or_else(|| {
        AgentSettingError::UnsafePath("write target has no parent directory".to_string())
    })?;
    fs::create_dir_all(parent)?;
    let mut temp = NamedTempFile::new_in(parent)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    temp.persist(path)
        .map_err(|error| AgentSettingError::Io(error.error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tempfile::TempDir;

    use super::*;
    use crate::executors::BaseCodingAgent;

    struct Harness {
        _root: TempDir,
        home: PathBuf,
        project: PathBuf,
        service: AgentSettingsService,
    }

    fn harness() -> Harness {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join("home");
        let project = root.path().join("project");
        fs::create_dir_all(&home).unwrap();
        fs::create_dir_all(&project).unwrap();
        let service = AgentSettingsService::new(
            home.clone(),
            root.path().join("assets/agent-settings/profiles-v1.json"),
        );
        Harness {
            _root: root,
            home,
            project,
            service,
        }
    }

    fn write(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn snapshot<'a>(
        inventory: &'a AgentSettingsInventory,
        provider: AgentSettingsProvider,
    ) -> &'a SettingsSnapshot {
        inventory
            .providers
            .iter()
            .find(|snapshot| snapshot.provider == provider)
            .unwrap()
    }

    #[test]
    fn four_provider_discovery_is_read_only_and_isolates_malformed_files() {
        let harness = harness();
        let codex = harness.home.join(".codex/config.toml");
        let claude = harness.home.join(".claude/settings.json");
        let gemini = harness.home.join(".gemini/settings.json");
        let omp = harness.home.join(".omp/agent/config.yml");
        write(&codex, "# keep me\nmodel = \"gpt-5\"\nunknown = 7\n");
        write(&claude, r#"{"model":"sonnet","unknown":{"keep":true}}"#);
        write(&gemini, "{ malformed");
        write(
            &omp,
            "theme:\n  dark: titanium\ncompaction:\n  enabled: true\nunknown: preserved\n",
        );
        let before = [
            fs::read(&codex).unwrap(),
            fs::read(&claude).unwrap(),
            fs::read(&gemini).unwrap(),
            fs::read(&omp).unwrap(),
        ];

        let inventory = harness.service.discover(None, Some(&harness.project));

        assert_eq!(inventory.providers.len(), 4);
        assert_eq!(
            snapshot(&inventory, AgentSettingsProvider::Codex)
                .errors
                .len(),
            0
        );
        assert_eq!(
            snapshot(&inventory, AgentSettingsProvider::ClaudeCode)
                .errors
                .len(),
            0
        );
        assert_eq!(
            snapshot(&inventory, AgentSettingsProvider::Gemini)
                .errors
                .len(),
            1
        );
        assert_eq!(
            snapshot(&inventory, AgentSettingsProvider::OhMyPi)
                .errors
                .len(),
            0
        );
        assert_eq!(before[0], fs::read(&codex).unwrap());
        assert_eq!(before[1], fs::read(&claude).unwrap());
        assert_eq!(before[2], fs::read(&gemini).unwrap());
        assert_eq!(before[3], fs::read(&omp).unwrap());
        assert!(
            snapshot(&inventory, AgentSettingsProvider::Codex)
                .unknown_native_nodes
                .iter()
                .any(|node| node.native_path == "unknown")
        );
    }

    #[test]
    fn codex_targeted_set_and_unset_preserve_comments_and_unknown_fields() {
        let harness = harness();
        let path = harness.home.join(".codex/config.toml");
        write(
            &path,
            "# user comment\nmodel = \"old\"\nunknown = \"keep\"\n\n[features]\nweb_search = false\n",
        );
        let manager = harness
            .service
            .manager(AgentSettingsProvider::Codex, Some(&harness.project));
        let original = manager.discover().unwrap();
        let revision = original.native_files[0].revision.clone().unwrap();
        let patch = SettingsPatch {
            provider: AgentSettingsProvider::Codex,
            project_path: Some(harness.project.display().to_string()),
            expected_file_revisions: BTreeMap::from([("user_config".into(), revision)]),
            operations: vec![
                SettingOperation::Set {
                    key: SettingKey::new("common", "model"),
                    scope: SettingScope::User,
                    value: json!("gpt-5.6"),
                },
                SettingOperation::Unset {
                    key: SettingKey::new("codex", "web_search"),
                    scope: SettingScope::User,
                },
            ],
        };
        let diff = manager.diff(&patch).unwrap();
        assert!(diff.files[0].after.contains("# user comment"));
        let result = manager.apply(&patch).unwrap();
        let content = fs::read_to_string(path).unwrap();
        assert!(content.contains("# user comment"));
        assert!(content.contains("unknown = \"keep\""));
        assert!(!content.contains("web_search"));
        let model = result
            .effective_settings
            .iter()
            .find(|setting| setting.key.id() == "common.model")
            .unwrap();
        assert_eq!(model.effective_value, Some(json!("gpt-5.6")));
    }

    #[test]
    fn stale_revision_rejects_without_overwriting_external_change() {
        let harness = harness();
        let path = harness.home.join(".claude/settings.json");
        write(&path, r#"{"model":"old","unknown":"keep"}"#);
        let manager = harness
            .service
            .manager(AgentSettingsProvider::ClaudeCode, Some(&harness.project));
        let revision = manager.discover().unwrap().native_files[0]
            .revision
            .clone()
            .unwrap();
        write(&path, r#"{"model":"external","unknown":"keep"}"#);
        let patch = SettingsPatch {
            provider: AgentSettingsProvider::ClaudeCode,
            project_path: Some(harness.project.display().to_string()),
            expected_file_revisions: BTreeMap::from([("user_settings".into(), revision)]),
            operations: vec![SettingOperation::Set {
                key: SettingKey::new("common", "model"),
                scope: SettingScope::User,
                value: json!("requested"),
            }],
        };
        assert!(matches!(
            manager.apply(&patch),
            Err(AgentSettingError::StaleRevision)
        ));
        assert_eq!(
            fs::read_to_string(path).unwrap(),
            r#"{"model":"external","unknown":"keep"}"#
        );
    }

    #[test]
    fn json_and_yaml_writes_preserve_unknown_native_nodes() {
        let harness = harness();
        let gemini = harness.home.join(".gemini/settings.json");
        let omp = harness.home.join(".omp/agent/config.yml");
        write(&gemini, r#"{"model":{"name":"old"},"unknown":{"x":1}}"#);
        write(&omp, "theme:\n  dark: old\nunknown:\n  x: 1\n");
        for (provider, file_id, key, value) in [
            (
                AgentSettingsProvider::Gemini,
                "user_settings",
                SettingKey::new("common", "model"),
                json!("new-model"),
            ),
            (
                AgentSettingsProvider::OhMyPi,
                "user_config",
                SettingKey::new("oh_my_pi", "dark_theme"),
                json!("new-theme"),
            ),
        ] {
            let manager = harness.service.manager(provider, Some(&harness.project));
            let snapshot = manager.discover().unwrap();
            let revision = snapshot
                .native_files
                .iter()
                .find(|file| file.id == file_id)
                .unwrap()
                .revision
                .clone()
                .unwrap();
            manager
                .apply(&SettingsPatch {
                    provider,
                    project_path: Some(harness.project.display().to_string()),
                    expected_file_revisions: BTreeMap::from([(file_id.into(), revision)]),
                    operations: vec![SettingOperation::Set {
                        key,
                        scope: SettingScope::User,
                        value,
                    }],
                })
                .unwrap();
        }
        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(gemini).unwrap()).unwrap()["unknown"]
                ["x"],
            json!(1)
        );
        assert_eq!(
            parse_document(NativeConfigFormat::Yaml, &fs::read_to_string(omp).unwrap()).unwrap()["unknown"]
                ["x"],
            json!(1)
        );
    }

    #[test]
    fn profile_crud_copy_and_apply_preview_use_common_slots_only() {
        let harness = harness();
        let codex = harness.home.join(".codex/config.toml");
        write(&codex, "model = \"old\"\n");
        let profile = ConfigProfile {
            id: Uuid::new_v4(),
            provider: AgentSettingsProvider::Codex,
            executor_profile: ExecutorProfileId::new(BaseCodingAgent::Codex),
            name: "Review".to_string(),
            schema_version: SETTINGS_PROFILE_STORE_VERSION,
            setting_overrides: BTreeMap::from([
                ("common.model".to_string(), json!("gpt-5.6")),
                ("codex.web_search".to_string(), json!(true)),
            ]),
            provider_extensions: BTreeMap::from([("codex.private".into(), json!(1))]),
            environment: BTreeMap::from([("EXACT".into(), "a=b c".into())]),
            custom_args: vec!["--flag=value".into()],
            updated_at: Utc::now(),
        };
        let saved = harness
            .service
            .save_profile(SaveConfigProfileRequest {
                profile: profile.clone(),
            })
            .unwrap();
        let copy = harness
            .service
            .copy_profile_preview(CopyProfilePreviewRequest {
                id: saved.id,
                target_provider: AgentSettingsProvider::ClaudeCode,
                target_executor_profile: ExecutorProfileId::new(BaseCodingAgent::ClaudeCode),
                target_name: "Copied".into(),
            })
            .unwrap();
        assert_eq!(copy.compatible_keys, vec!["common.model"]);
        assert_eq!(copy.skipped_keys, vec!["codex.web_search"]);
        assert!(copy.profile.provider_extensions.is_empty());
        assert_eq!(copy.profile.environment["EXACT"], "a=b c");

        let revision = harness
            .service
            .manager(AgentSettingsProvider::Codex, Some(&harness.project))
            .discover()
            .unwrap()
            .native_files[0]
            .revision
            .clone()
            .unwrap();
        let preview = harness
            .service
            .preview_profile_apply(&ProfileApplyPreviewRequest {
                id: saved.id,
                project_path: Some(harness.project.display().to_string()),
                scope: SettingScope::User,
                expected_file_revisions: BTreeMap::from([("user_config".into(), revision)]),
            })
            .unwrap();
        assert!(preview.files[0].after.contains("gpt-5.6"));

        harness
            .service
            .delete_profile(DeleteConfigProfileRequest { id: saved.id })
            .unwrap();
        assert!(harness.service.list_profiles(None).unwrap().is_empty());
    }

    #[test]
    fn raw_edit_requires_current_revision_and_valid_syntax() {
        let harness = harness();
        let path = harness.home.join(".gemini/settings.json");
        write(&path, r#"{"telemetry":{"enabled":false}}"#);
        let manager = harness
            .service
            .manager(AgentSettingsProvider::Gemini, Some(&harness.project));
        let revision = manager.discover().unwrap().native_files[0]
            .revision
            .clone()
            .unwrap();
        let invalid = NativeFilePatch {
            provider: AgentSettingsProvider::Gemini,
            project_path: Some(harness.project.display().to_string()),
            file_id: "user_settings".into(),
            expected_revision: revision.clone(),
            content: "{".into(),
        };
        assert!(matches!(
            manager.diff_native_file(&invalid),
            Err(AgentSettingError::InvalidConfiguration(_))
        ));
        let valid = NativeFilePatch {
            content: r#"{"telemetry":{"enabled":true},"nativeOnly":1}"#.into(),
            ..invalid
        };
        manager.apply_native_file(&valid).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(path).unwrap()).unwrap()["nativeOnly"],
            json!(1)
        );
    }

    #[test]
    fn rollback_restores_exact_bytes_and_removes_new_files() {
        let harness = harness();
        let existing = harness.home.join("existing.json");
        let created = harness.home.join("created.json");
        write(&existing, "{\r\n  \"before\": true\r\n}\r\n");
        write(&created, "new");
        let files = vec![
            RenderedFile {
                spec: file_spec(
                    "existing",
                    existing.clone(),
                    NativeConfigFormat::Json,
                    SettingScope::User,
                ),
                before: Some(b"{\r\n  \"before\": true\r\n}\r\n".to_vec()),
                after: b"changed".to_vec(),
            },
            RenderedFile {
                spec: file_spec(
                    "created",
                    created.clone(),
                    NativeConfigFormat::Json,
                    SettingScope::User,
                ),
                before: None,
                after: b"new".to_vec(),
            },
        ];
        rollback_files(&files).unwrap();
        assert_eq!(
            fs::read(existing).unwrap(),
            b"{\r\n  \"before\": true\r\n}\r\n"
        );
        assert!(!created.exists());
    }
}
