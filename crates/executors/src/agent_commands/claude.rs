use std::path::{Path, PathBuf};

use super::{
    AgentCommandDefinition, AgentCommandError, AgentCommandFormat,
    AgentCommandProviderCapabilities, AgentCommandScope, markdown,
};

pub(super) fn capabilities() -> AgentCommandProviderCapabilities {
    AgentCommandProviderCapabilities {
        discoverable: true,
        creatable: true,
        supported_scopes: vec![AgentCommandScope::User, AgentCommandScope::Project],
        writable_formats: vec![AgentCommandFormat::ClaudeMarkdown],
    }
}

pub(super) fn managed_root(
    home_dir: &Path,
    project_root: Option<&Path>,
    scope: AgentCommandScope,
) -> Result<PathBuf, AgentCommandError> {
    match scope {
        AgentCommandScope::User => Ok(home_dir.join(".claude/commands")),
        AgentCommandScope::Project => Ok(project_root
            .ok_or_else(|| {
                AgentCommandError::InvalidRequest("project scope requires project_path".into())
            })?
            .join(".claude/commands")),
    }
}

pub(super) fn parse(bytes: &[u8]) -> Result<AgentCommandDefinition, AgentCommandError> {
    let content = std::str::from_utf8(bytes)
        .map_err(|_| AgentCommandError::InvalidConfiguration("command file is not UTF-8".into()))?;
    let command = markdown::parse(content)?;
    Ok(AgentCommandDefinition::ClaudeCode {
        description: markdown::string_field(command.frontmatter, "description")?,
        body: command.body.to_owned(),
    })
}

pub(super) fn render(
    current_source: Option<&str>,
    definition: &AgentCommandDefinition,
) -> Result<String, AgentCommandError> {
    let AgentCommandDefinition::ClaudeCode { description, body } = definition else {
        return Err(AgentCommandError::InvalidRequest(
            "definition does not match Claude command format".into(),
        ));
    };
    markdown::render(
        current_source,
        &[("description", description.as_deref())],
        body,
    )
}

pub(super) const LIMITATION: &str = "Agent Center manages provider-native Markdown commands; plugin-owned commands remain owned by their plugin.";
