use std::{
    fs,
    path::{Path, PathBuf},
};

use tempfile::TempDir;

use super::*;

fn harness() -> (TempDir, AgentCommandService, PathBuf) {
    let root = tempfile::tempdir().unwrap();
    let home = root.path().join("home");
    let project = root.path().join("project");
    fs::create_dir_all(&project).unwrap();
    for provider_root in [".codex", ".claude", ".gemini", ".omp/agent"] {
        fs::create_dir_all(home.join(provider_root)).unwrap();
    }
    let service =
        AgentCommandService::new(home, root.path().join("assets/agent-commands/disabled/v1"));
    (root, service, project)
}

fn locator(
    provider: AgentCommandProvider,
    scope: AgentCommandScope,
    name: &str,
    project: Option<&Path>,
) -> AgentCommandLocator {
    AgentCommandLocator {
        provider,
        scope,
        name: name.into(),
        installation_id: None,
        project_path: project.map(|path| path.to_string_lossy().to_string()),
    }
}

fn claude_definition(body: &str) -> AgentCommandWriteDefinition {
    AgentCommandWriteDefinition::ClaudeCode {
        description: OptionalCommandTextWrite::Replace {
            value: "Review changes".into(),
        },
        body: CommandTextWrite::Replace { value: body.into() },
    }
}

#[test]
fn claude_crud_preserves_unknown_frontmatter_and_rejects_stale_revision() {
    let (_root, service, project) = harness();
    let target = locator(
        AgentCommandProvider::ClaudeCode,
        AgentCommandScope::Project,
        "git:review",
        Some(&project),
    );
    let created = service
        .create(CreateAgentCommandRequest {
            target: target.clone(),
            definition: claude_definition("Review $ARGUMENTS"),
            replace: false,
            expected_revision: None,
        })
        .unwrap();
    assert!(matches!(
        created.definition,
        AgentCommandDefinitionView::ClaudeCode { ref body, .. }
            if body == "Review $ARGUMENTS"
    ));

    let path = project.join(".claude/commands/git/review.md");
    let original = fs::read_to_string(&path).unwrap();
    fs::write(
        &path,
        original.replacen("---\n", "---\nallowed-tools: Read\n# keep-me\n", 1),
    )
    .unwrap();
    let refreshed = service
        .manager(AgentCommandProvider::ClaudeCode, Some(&project))
        .find(&target)
        .unwrap();
    let updated = service
        .update(UpdateAgentCommandRequest {
            target: AgentCommandLocator {
                installation_id: Some(installation_id(&refreshed)),
                ..target.clone()
            },
            expected_revision: refreshed.revision,
            definition: AgentCommandWriteDefinition::ClaudeCode {
                description: OptionalCommandTextWrite::Preserve,
                body: CommandTextWrite::Replace {
                    value: "Updated body".into(),
                },
            },
        })
        .unwrap();
    let rendered = fs::read_to_string(path).unwrap();
    assert!(rendered.contains("allowed-tools: Read"));
    assert!(rendered.contains("# keep-me"));
    assert!(rendered.ends_with("Updated body"));

    let error = service
        .update(UpdateAgentCommandRequest {
            target,
            expected_revision: created.revision,
            definition: claude_definition("stale"),
        })
        .unwrap_err();
    assert!(matches!(error, AgentCommandError::StaleRevision));
    assert!(!updated.revision.is_empty());
}

#[test]
fn gemini_toml_preserves_comments_and_unknown_fields() {
    let (_root, service, project) = harness();
    let path = project.join(".gemini/commands/git");
    fs::create_dir_all(&path).unwrap();
    let path = path.join("commit.toml");
    fs::write(
        &path,
        "# keep\ndescription = \"Commit\"\nprompt = \"Old\"\nunknown = 42\n",
    )
    .unwrap();
    let target = locator(
        AgentCommandProvider::Gemini,
        AgentCommandScope::Project,
        "git:commit",
        Some(&project),
    );
    let current = service
        .manager(AgentCommandProvider::Gemini, Some(&project))
        .find(&target)
        .unwrap();
    service
        .update(UpdateAgentCommandRequest {
            target,
            expected_revision: current.revision,
            definition: AgentCommandWriteDefinition::Gemini {
                description: OptionalCommandTextWrite::Preserve,
                prompt: CommandTextWrite::Replace {
                    value: "New {{args}}".into(),
                },
            },
        })
        .unwrap();
    let rendered = fs::read_to_string(path).unwrap();
    assert!(rendered.contains("# keep"));
    assert!(rendered.contains("unknown = 42"));
    assert!(rendered.contains("New {{args}}"));
}

#[test]
fn prompt_disable_and_restore_changes_opaque_identity() {
    let (_root, service, _project) = harness();
    let target = locator(
        AgentCommandProvider::ClaudeCode,
        AgentCommandScope::User,
        "review",
        None,
    );
    let created = service
        .create(CreateAgentCommandRequest {
            target: target.clone(),
            definition: claude_definition("Review"),
            replace: false,
            expected_revision: None,
        })
        .unwrap();
    let disabled = service
        .set_enabled(ToggleAgentCommandRequest {
            target: AgentCommandLocator {
                installation_id: Some(created.installation_id.clone()),
                ..target.clone()
            },
            expected_revision: created.revision,
            enabled: false,
        })
        .unwrap();
    assert_eq!(disabled.state, AgentCommandState::Disabled);
    assert_ne!(disabled.installation_id, created.installation_id);
    let enabled = service
        .set_enabled(ToggleAgentCommandRequest {
            target: AgentCommandLocator {
                installation_id: Some(disabled.installation_id.clone()),
                ..target
            },
            expected_revision: disabled.revision,
            enabled: true,
        })
        .unwrap();
    assert_eq!(enabled.state, AgentCommandState::Enabled);
    assert_ne!(enabled.installation_id, disabled.installation_id);
}

#[test]
fn omp_prompt_is_managed_but_executable_module_is_safe_read_only_summary() {
    let (_root, service, _project) = harness();
    let manager = service.manager(AgentCommandProvider::OhMyPi, None);
    let prompt_root = manager.managed_root(AgentCommandScope::User).unwrap();
    assert!(prompt_root.ends_with(".omp/agent/commands"));
    fs::create_dir_all(&prompt_root).unwrap();
    fs::write(
        prompt_root.join("review.md"),
        "---\ndescription: Review\n---\nCheck the diff",
    )
    .unwrap();
    let executable_root = manager.executable_root(AgentCommandScope::User).unwrap();
    fs::create_dir_all(executable_root.join("deploy")).unwrap();
    fs::write(
        executable_root.join("deploy/index.ts"),
        "export default () => ({ name: 'deploy' });",
    )
    .unwrap();
    fs::create_dir_all(prompt_root.join("nested")).unwrap();
    fs::write(prompt_root.join("nested/ignored.md"), "Not a native prompt").unwrap();
    let inventory = manager.discover().unwrap();
    let prompt = inventory
        .items
        .iter()
        .find(|item| item.name == "review")
        .unwrap();
    assert!(prompt.capabilities.editable);
    let executable = inventory
        .items
        .iter()
        .find(|item| item.name == "deploy")
        .unwrap();
    assert_eq!(executable.state, AgentCommandState::Unsupported);
    assert!(!executable.capabilities.editable);
    let serialized = serde_json::to_string(executable).unwrap();
    assert!(!serialized.contains("export default"));
    assert!(!serialized.contains("index.ts"));
    assert!(inventory.items.iter().all(|item| item.name != "ignored"));
}

#[test]
fn create_never_clobbers_a_target_that_already_exists() {
    let root = tempfile::tempdir().unwrap();
    let target = root.path().join("command.md");
    fs::write(&target, "external").unwrap();

    let error = atomic_create(&target, b"managed").unwrap_err();

    assert!(matches!(error, AgentCommandError::Collision(_)));
    assert_eq!(fs::read_to_string(target).unwrap(), "external");
}

#[test]
fn stale_remove_preserves_external_changes() {
    let (_root, service, _project) = harness();
    let target = locator(
        AgentCommandProvider::ClaudeCode,
        AgentCommandScope::User,
        "review",
        None,
    );
    let created = service
        .create(CreateAgentCommandRequest {
            target: target.clone(),
            definition: claude_definition("Review"),
            replace: false,
            expected_revision: None,
        })
        .unwrap();
    let path = service
        .manager(AgentCommandProvider::ClaudeCode, None)
        .managed_root(AgentCommandScope::User)
        .unwrap()
        .join("review.md");
    fs::write(&path, "external edit").unwrap();

    let error = service
        .remove(RemoveAgentCommandRequest {
            target,
            expected_revision: created.revision,
        })
        .unwrap_err();

    assert!(matches!(error, AgentCommandError::StaleRevision));
    assert_eq!(fs::read_to_string(path).unwrap(), "external edit");
}

#[test]
fn restore_collision_preserves_both_external_target_and_disabled_record() {
    let (_root, service, _project) = harness();
    let target = locator(
        AgentCommandProvider::ClaudeCode,
        AgentCommandScope::User,
        "review",
        None,
    );
    let created = service
        .create(CreateAgentCommandRequest {
            target: target.clone(),
            definition: claude_definition("Review"),
            replace: false,
            expected_revision: None,
        })
        .unwrap();
    let disabled = service
        .set_enabled(ToggleAgentCommandRequest {
            target: AgentCommandLocator {
                installation_id: Some(created.installation_id),
                ..target.clone()
            },
            expected_revision: created.revision,
            enabled: false,
        })
        .unwrap();
    let manager = service.manager(AgentCommandProvider::ClaudeCode, None);
    let target_path = manager
        .managed_root(AgentCommandScope::User)
        .unwrap()
        .join("review.md");
    fs::write(&target_path, "external").unwrap();

    let error = service
        .set_enabled(ToggleAgentCommandRequest {
            target: AgentCommandLocator {
                installation_id: Some(disabled.installation_id.clone()),
                ..target.clone()
            },
            expected_revision: disabled.revision,
            enabled: true,
        })
        .unwrap_err();

    assert!(matches!(error, AgentCommandError::Collision(_)));
    assert_eq!(fs::read_to_string(target_path).unwrap(), "external");
    assert!(
        manager
            .find(&AgentCommandLocator {
                installation_id: Some(disabled.installation_id),
                ..target
            })
            .is_ok()
    );
}

#[cfg(unix)]
#[test]
fn project_symlink_is_rejected() {
    use std::os::unix::fs::symlink;

    let (root, service, project) = harness();
    let linked = root.path().join("linked-project");
    symlink(&project, &linked).unwrap();
    assert!(matches!(
        service
            .manager(AgentCommandProvider::ClaudeCode, Some(&linked))
            .managed_root(AgentCommandScope::Project),
        Err(AgentCommandError::UnsafePath(_))
    ));
}

#[cfg(windows)]
#[test]
fn project_reparse_point_is_rejected_when_symlink_creation_is_available() {
    use std::os::windows::fs::symlink_dir;

    let (root, service, project) = harness();
    let linked = root.path().join("linked-project");
    if symlink_dir(&project, &linked).is_err() {
        return;
    }
    assert!(matches!(
        service
            .manager(AgentCommandProvider::ClaudeCode, Some(&linked))
            .managed_root(AgentCommandScope::Project),
        Err(AgentCommandError::UnsafePath(_))
    ));
}

#[test]
fn codex_legacy_prompts_are_user_scoped_and_managed() {
    let (_root, service, project) = harness();
    let inventory = service.discover(None);
    let codex = inventory
        .providers
        .iter()
        .find(|provider| provider.provider == AgentCommandProvider::Codex)
        .unwrap();
    assert!(codex.capabilities.discoverable);
    assert!(codex.capabilities.creatable);
    assert_eq!(
        codex.capabilities.supported_scopes,
        vec![AgentCommandScope::User]
    );
    assert!(
        codex
            .limitations
            .iter()
            .any(|item| item.contains("deprecated"))
    );

    let created = service
        .create(CreateAgentCommandRequest {
            target: locator(
                AgentCommandProvider::Codex,
                AgentCommandScope::User,
                "review",
                None,
            ),
            definition: AgentCommandWriteDefinition::CodexLegacy {
                description: OptionalCommandTextWrite::Replace {
                    value: "Review changes".into(),
                },
                argument_hint: OptionalCommandTextWrite::Replace {
                    value: "[BASE]".into(),
                },
                body: CommandTextWrite::Replace {
                    value: "Review $ARGUMENTS".into(),
                },
            },
            replace: false,
            expected_revision: None,
        })
        .unwrap();
    assert!(matches!(
        created.definition,
        AgentCommandDefinitionView::CodexLegacy {
            ref argument_hint,
            ref body,
            ..
        } if argument_hint.as_deref() == Some("[BASE]") && body == "Review $ARGUMENTS"
    ));

    let project_error = service
        .create(CreateAgentCommandRequest {
            target: locator(
                AgentCommandProvider::Codex,
                AgentCommandScope::Project,
                "review",
                Some(&project),
            ),
            definition: AgentCommandWriteDefinition::CodexLegacy {
                description: OptionalCommandTextWrite::Clear,
                argument_hint: OptionalCommandTextWrite::Clear,
                body: CommandTextWrite::Replace {
                    value: "Unsupported".into(),
                },
            },
            replace: false,
            expected_revision: None,
        })
        .unwrap_err();
    assert!(matches!(project_error, AgentCommandError::Unsupported(_)));
}

#[test]
fn malformed_provider_file_does_not_hide_other_providers() {
    let (_root, service, _project) = harness();
    let gemini = service.manager(AgentCommandProvider::Gemini, None);
    let gemini_root = gemini.managed_root(AgentCommandScope::User).unwrap();
    fs::create_dir_all(&gemini_root).unwrap();
    fs::write(gemini_root.join("broken.toml"), "prompt = [").unwrap();
    let claude = service.manager(AgentCommandProvider::ClaudeCode, None);
    let claude_root = claude.managed_root(AgentCommandScope::User).unwrap();
    fs::create_dir_all(&claude_root).unwrap();
    fs::write(claude_root.join("healthy.md"), "Healthy").unwrap();

    let inventory = service.discover(None);
    let gemini = inventory
        .providers
        .iter()
        .find(|provider| provider.provider == AgentCommandProvider::Gemini)
        .unwrap();
    assert_eq!(gemini.items[0].state, AgentCommandState::Error);
    let claude = inventory
        .providers
        .iter()
        .find(|provider| provider.provider == AgentCommandProvider::ClaudeCode)
        .unwrap();
    assert_eq!(claude.items[0].name, "healthy");
    assert_eq!(claude.items[0].state, AgentCommandState::Enabled);
}
