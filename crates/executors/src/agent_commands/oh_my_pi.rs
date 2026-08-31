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
        writable_formats: vec![AgentCommandFormat::OhMyPiPromptMarkdown],
    }
}

pub(super) fn managed_root(
    home_dir: &Path,
    project_root: Option<&Path>,
    scope: AgentCommandScope,
) -> Result<PathBuf, AgentCommandError> {
    match scope {
        AgentCommandScope::User => Ok(home_dir.join(".omp/agent/commands")),
        AgentCommandScope::Project => Ok(project_root
            .ok_or_else(|| {
                AgentCommandError::InvalidRequest("project scope requires project_path".into())
            })?
            .join(".omp/commands")),
    }
}

pub(super) fn executable_root(
    home_dir: &Path,
    project_root: Option<&Path>,
    scope: AgentCommandScope,
) -> Result<PathBuf, AgentCommandError> {
    match scope {
        AgentCommandScope::User => Ok(home_dir.join(".omp/agent/commands")),
        AgentCommandScope::Project => Ok(project_root
            .ok_or_else(|| {
                AgentCommandError::InvalidRequest("project scope requires project_path".into())
            })?
            .join(".omp/commands")),
    }
}

pub(super) fn parse_prompt(bytes: &[u8]) -> Result<AgentCommandDefinition, AgentCommandError> {
    let content = std::str::from_utf8(bytes)
        .map_err(|_| AgentCommandError::InvalidConfiguration("command file is not UTF-8".into()))?;
    let command = markdown::parse(content)?;
    Ok(AgentCommandDefinition::OhMyPiPrompt {
        description: markdown::string_field(command.frontmatter, "description")?,
        body: command.body.to_owned(),
    })
}

pub(super) fn render_prompt(
    current_source: Option<&str>,
    definition: &AgentCommandDefinition,
) -> Result<String, AgentCommandError> {
    let AgentCommandDefinition::OhMyPiPrompt { description, body } = definition else {
        return Err(AgentCommandError::InvalidRequest(
            "definition does not match Oh My Pi prompt format".into(),
        ));
    };
    markdown::render(
        current_source,
        &[("description", description.as_deref())],
        body,
    )
}

pub(super) const LIMITATION: &str = "Agent Center manages top-level Markdown commands in the native commands directory. Executable command modules are discovered read-only, named profiles remain unmanaged, and executable source is never sent to the browser.";
