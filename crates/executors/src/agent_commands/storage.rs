use std::{
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;

use super::{
    AgentCommandError, AgentCommandFormat, AgentCommandProvider, AgentCommandScope,
    service::validate_name,
};

pub(super) const DISABLED_STORE_VERSION: u32 = 1;
const MAX_COMMAND_BYTES: u64 = 1024 * 1024;

fn is_link_or_reparse(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;

        // Junctions and other reparse points are not guaranteed to report as
        // ordinary symlinks through every Windows filesystem API.
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        return metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0;
    }
    #[cfg(not(windows))]
    false
}

pub(super) fn ensure_no_link_components(path: &Path) -> Result<(), AgentCommandError> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        match fs::symlink_metadata(&current) {
            Ok(metadata) if is_link_or_reparse(&metadata) => {
                return Err(AgentCommandError::UnsafePath(
                    "command path contains a symbolic link or reparse point".into(),
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

pub(super) fn read_command_bytes(path: &Path) -> Result<Vec<u8>, AgentCommandError> {
    ensure_no_link_components(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if is_link_or_reparse(&metadata) || !metadata.is_file() {
        return Err(AgentCommandError::UnsafePath(
            "command target must be a regular file".into(),
        ));
    }
    if metadata.len() > MAX_COMMAND_BYTES {
        return Err(AgentCommandError::InvalidConfiguration(format!(
            "command exceeds {MAX_COMMAND_BYTES} bytes"
        )));
    }
    Ok(fs::read(path)?)
}

pub(super) fn hash_file(path: &Path) -> Result<String, AgentCommandError> {
    Ok(format!("{:x}", Sha256::digest(read_command_bytes(path)?)))
}

pub(super) fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

pub(super) fn ensure_revision(current: &str, expected: &str) -> Result<(), AgentCommandError> {
    if current == expected {
        Ok(())
    } else {
        Err(AgentCommandError::StaleRevision)
    }
}

pub(super) fn ensure_directory_not_symlink(path: &Path) -> Result<(), AgentCommandError> {
    ensure_no_link_components(path)
}

pub(super) fn ensure_safe_file(path: &Path) -> Result<(), AgentCommandError> {
    ensure_no_link_components(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if is_link_or_reparse(&metadata) || !metadata.is_file() {
        return Err(AgentCommandError::UnsafePath(
            "command target must be a regular file".into(),
        ));
    }
    Ok(())
}

pub(super) fn safe_relative_path(value: &str) -> Result<PathBuf, AgentCommandError> {
    let path = PathBuf::from(value);
    if path.as_os_str().is_empty()
        || path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AgentCommandError::UnsafePath(
            "disabled command has an unsafe relative path".into(),
        ));
    }
    Ok(path)
}

pub(super) fn portable_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn validate_write<'a>(path: &'a Path, bytes: &[u8]) -> Result<&'a Path, AgentCommandError> {
    if bytes.len() as u64 > MAX_COMMAND_BYTES {
        return Err(AgentCommandError::InvalidConfiguration(format!(
            "command exceeds {MAX_COMMAND_BYTES} bytes"
        )));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AgentCommandError::UnsafePath("write target has no parent".into()))?;
    ensure_no_link_components(parent)?;
    fs::create_dir_all(parent)?;
    // create_dir_all may have traversed components that did not exist during
    // the first check. Validate the final chain before placing a file in it.
    ensure_no_link_components(parent)?;
    Ok(parent)
}

fn write_temporary(parent: &Path, bytes: &[u8]) -> Result<NamedTempFile, AgentCommandError> {
    let mut temporary = NamedTempFile::new_in(parent)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    Ok(temporary)
}

pub(super) fn atomic_create(path: &Path, bytes: &[u8]) -> Result<(), AgentCommandError> {
    let parent = validate_write(path, bytes)?;
    let temporary = write_temporary(parent, bytes)?;
    temporary.persist_noclobber(path).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            AgentCommandError::Collision("target appeared before command creation".into())
        } else {
            AgentCommandError::Io(error.error)
        }
    })?;
    Ok(())
}

pub(super) fn atomic_replace(
    path: &Path,
    bytes: &[u8],
    expected_revision: &str,
) -> Result<(), AgentCommandError> {
    let parent = validate_write(path, bytes)?;
    ensure_safe_file(path)?;
    ensure_revision(&hash_file(path)?, expected_revision)?;
    let temporary = write_temporary(parent, bytes)?;
    // Close the widest practical TOCTOU window: an external edit after the
    // caller's discovery or while rendering must fail before replacement.
    ensure_revision(&hash_file(path)?, expected_revision)?;
    temporary
        .persist(path)
        .map_err(|error| AgentCommandError::Io(error.error))?;
    Ok(())
}

pub(super) fn atomic_write_json<T: Serialize>(
    path: &Path,
    value: &T,
) -> Result<(), AgentCommandError> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| AgentCommandError::InvalidConfiguration(error.to_string()))?;
    atomic_create(path, &bytes)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct DisabledCommandRecord {
    pub(super) version: u32,
    pub(super) provider: AgentCommandProvider,
    pub(super) scope: AgentCommandScope,
    pub(super) name: String,
    pub(super) format: AgentCommandFormat,
    pub(super) relative_path: String,
    pub(super) content_base64: String,
}

pub(super) fn read_disabled_record(
    path: &Path,
) -> Result<DisabledCommandRecord, AgentCommandError> {
    let record: DisabledCommandRecord = serde_json::from_slice(&read_command_bytes(path)?)
        .map_err(|error| AgentCommandError::InvalidConfiguration(error.to_string()))?;
    if record.version != DISABLED_STORE_VERSION {
        return Err(AgentCommandError::Unsupported(format!(
            "disabled command store version {}",
            record.version
        )));
    }
    validate_name(record.provider, &record.name)?;
    if !record.format.is_managed_prompt() {
        return Err(AgentCommandError::Unsupported(
            "executable commands cannot enter the disabled prompt store".into(),
        ));
    }
    safe_relative_path(&record.relative_path)?;
    Ok(record)
}
