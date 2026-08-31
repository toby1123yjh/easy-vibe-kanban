use std::path::{Path, PathBuf};

use super::{
    AgentCommandDefinition, AgentCommandError, AgentCommandFormat,
    AgentCommandProviderCapabilities, AgentCommandScope, markdown,
};

pub(super) fn capabilities() -> AgentCommandProviderCapabilities {
    AgentCommandProviderCapabilities {
        discoverable: true,
        creatable: true,
        supported_scopes: vec![AgentCommandScope::User],
        writable_formats: vec![AgentCommandFormat::CodexLegacyMarkdown],
    }
}

pub(super) fn managed_root(
    home_dir: &Path,
    scope: AgentCommandScope,
) -> Result<PathBuf, AgentCommandError> {
    match scope {
        AgentCommandScope::User => Ok(home_dir.join(".codex/prompts")),
        AgentCommandScope::Project => Err(AgentCommandError::Unsupported(
            "Codex legacy custom prompts only support user scope".into(),
        )),
    }
}

pub(super) fn parse(bytes: &[u8]) -> Result<AgentCommandDefinition, AgentCommandError> {
    let content = std::str::from_utf8(bytes)
        .map_err(|_| AgentCommandError::InvalidConfiguration("command file is not UTF-8".into()))?;
    let command = markdown::parse(content)?;
    Ok(AgentCommandDefinition::CodexLegacy {
        description: markdown::string_field(command.frontmatter, "description")?,
        argument_hint: markdown::string_field(command.frontmatter, "argument-hint")?,
        body: command.body.to_owned(),
    })
}

pub(super) fn render(
    current_source: Option<&str>,
    definition: &AgentCommandDefinition,
) -> Result<String, AgentCommandError> {
    let AgentCommandDefinition::CodexLegacy {
        description,
        argument_hint,
        body,
    } = definition
    else {
        return Err(AgentCommandError::InvalidRequest(
            "definition does not match Codex legacy prompt format".into(),
        ));
    };
    markdown::render(
        current_source,
        &[
            ("description", description.as_deref()),
            ("argument-hint", argument_hint.as_deref()),
        ],
        body,
    )
}

pub(super) const LIMITATION: &str = "Codex custom prompts are deprecated and user-scoped only. Existing ~/.codex/prompts/*.md files remain manageable, but new reusable instructions should prefer Skills; prompt changes require a new session or restart.";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targeted_write_preserves_unknown_frontmatter() {
        let source =
            "---\ndescription: old\nargument-hint: OLD\ncustom: keep\n# comment\n---\nOld body";
        let rendered = render(
            Some(source),
            &AgentCommandDefinition::CodexLegacy {
                description: Some("new".into()),
                argument_hint: Some("[FILE]".into()),
                body: "New body".into(),
            },
        )
        .unwrap();
        assert!(rendered.contains("custom: keep"));
        assert!(rendered.contains("# comment"));
        assert!(rendered.contains("argument-hint: \"[FILE]\""));
        assert!(rendered.ends_with("New body"));
    }
}
