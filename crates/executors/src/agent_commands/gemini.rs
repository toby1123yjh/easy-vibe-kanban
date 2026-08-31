use std::path::{Path, PathBuf};

use toml_edit::{DocumentMut, value};

use super::{
    AgentCommandDefinition, AgentCommandError, AgentCommandFormat,
    AgentCommandProviderCapabilities, AgentCommandScope,
};

pub(super) fn capabilities() -> AgentCommandProviderCapabilities {
    AgentCommandProviderCapabilities {
        discoverable: true,
        creatable: true,
        supported_scopes: vec![AgentCommandScope::User, AgentCommandScope::Project],
        writable_formats: vec![AgentCommandFormat::GeminiToml],
    }
}

pub(super) fn managed_root(
    home_dir: &Path,
    project_root: Option<&Path>,
    scope: AgentCommandScope,
) -> Result<PathBuf, AgentCommandError> {
    match scope {
        AgentCommandScope::User => Ok(home_dir.join(".gemini/commands")),
        AgentCommandScope::Project => Ok(project_root
            .ok_or_else(|| {
                AgentCommandError::InvalidRequest("project scope requires project_path".into())
            })?
            .join(".gemini/commands")),
    }
}

pub(super) fn parse(bytes: &[u8]) -> Result<AgentCommandDefinition, AgentCommandError> {
    let content = std::str::from_utf8(bytes)
        .map_err(|_| AgentCommandError::InvalidConfiguration("command file is not UTF-8".into()))?;
    let document = content.parse::<DocumentMut>().map_err(|error| {
        AgentCommandError::InvalidConfiguration(format!("invalid TOML: {error}"))
    })?;
    let prompt = document
        .get("prompt")
        .and_then(|item| item.as_str())
        .ok_or_else(|| {
            AgentCommandError::InvalidConfiguration(
                "Gemini command requires a string prompt".into(),
            )
        })?
        .to_owned();
    let description = match document.get("description") {
        Some(item) => Some(
            item.as_str()
                .ok_or_else(|| {
                    AgentCommandError::InvalidConfiguration(
                        "Gemini command description must be a string".into(),
                    )
                })?
                .to_owned(),
        ),
        None => None,
    };
    Ok(AgentCommandDefinition::Gemini {
        description,
        prompt,
    })
}

pub(super) fn render(
    current_source: Option<&str>,
    definition: &AgentCommandDefinition,
) -> Result<String, AgentCommandError> {
    let AgentCommandDefinition::Gemini {
        description,
        prompt,
    } = definition
    else {
        return Err(AgentCommandError::InvalidRequest(
            "definition does not match Gemini command format".into(),
        ));
    };
    let mut document = match current_source {
        Some(source) => source.parse::<DocumentMut>().map_err(|error| {
            AgentCommandError::InvalidConfiguration(format!("invalid TOML: {error}"))
        })?,
        None => DocumentMut::new(),
    };
    document["prompt"] = value(prompt);
    match description {
        Some(description) => document["description"] = value(description),
        None => {
            document.remove("description");
        }
    }
    Ok(document.to_string())
}

pub(super) const LIMITATION: &str = "Agent Center manages provider-native TOML prompt commands; extension-owned commands remain owned by their extension.";
