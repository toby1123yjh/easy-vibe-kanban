use std::{collections::HashMap, path::PathBuf};

use git::GitService;
use tokio::process::Command;

use crate::command::CmdOverrides;

/// Repository context for executor operations
#[derive(Debug, Clone, Default)]
pub struct RepoContext {
    pub workspace_root: PathBuf,
    /// Names of repositories in the workspace (subdirectory names)
    pub repo_names: Vec<String>,
}

impl RepoContext {
    pub fn new(workspace_root: PathBuf, repo_names: Vec<String>) -> Self {
        Self {
            workspace_root,
            repo_names,
        }
    }

    pub fn repo_paths(&self) -> Vec<PathBuf> {
        self.repo_names
            .iter()
            .map(|name| self.workspace_root.join(name))
            .collect()
    }

    /// Check all repos for uncommitted changes.
    /// Returns a formatted string describing any uncommitted changes found,
    /// or an empty string if all repos are clean.
    pub async fn check_uncommitted_changes(&self) -> String {
        let repo_paths = self.repo_paths();
        if repo_paths.is_empty() {
            return String::new();
        }

        tokio::task::spawn_blocking(move || {
            let git = GitService::new();
            let mut all_status = String::new();

            for repo_path in &repo_paths {
                // Skip if not a git repository
                if !repo_path.join(".git").exists() {
                    continue;
                }

                match git.get_worktree_status(repo_path) {
                    Ok(status) if !status.entries.is_empty() => {
                        let mut status_output = String::new();
                        for entry in &status.entries {
                            status_output.push(entry.staged);
                            status_output.push(entry.unstaged);
                            status_output.push(' ');
                            status_output.push_str(&String::from_utf8_lossy(&entry.path));
                            status_output.push('\n');
                        }
                        all_status.push_str(&format!(
                            "\n{}:\n{}",
                            repo_path.display(),
                            status_output
                        ));
                    }
                    _ => {}
                }
            }

            all_status
        })
        .await
        .unwrap_or_default()
    }
}

/// Environment variables to inject into executor processes
#[derive(Clone)]
pub struct ExecutionEnv {
    pub vars: HashMap<String, String>,
    pub repo_context: RepoContext,
    pub commit_reminder: bool,
    pub commit_reminder_prompt: String,
}

impl std::fmt::Debug for ExecutionEnv {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let vars: HashMap<_, _> = self
            .vars
            .iter()
            .map(|(key, value)| {
                (
                    key,
                    if crate::workflow_mcp::is_token_env_key(key) {
                        "<redacted>"
                    } else {
                        value.as_str()
                    },
                )
            })
            .collect();
        formatter
            .debug_struct("ExecutionEnv")
            .field("vars", &vars)
            .field("repo_context", &self.repo_context)
            .field("commit_reminder", &self.commit_reminder)
            .field("commit_reminder_prompt", &self.commit_reminder_prompt)
            .finish()
    }
}

impl ExecutionEnv {
    pub fn new(
        repo_context: RepoContext,
        commit_reminder: bool,
        commit_reminder_prompt: String,
    ) -> Self {
        Self {
            vars: HashMap::new(),
            repo_context,
            commit_reminder,
            commit_reminder_prompt,
        }
    }

    /// Insert an environment variable
    pub fn insert(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.vars.insert(key.into(), value.into());
    }

    /// Merge additional vars into this env. Incoming keys overwrite existing ones.
    pub fn merge(&mut self, other: &HashMap<String, String>) {
        let scoped = self
            .vars
            .keys()
            .any(|key| crate::workflow_mcp::is_context_env_key(key));
        self.vars.extend(
            other
                .iter()
                .filter(|(key, _)| {
                    !crate::workflow_mcp::is_context_env_key(key)
                        && !(scoped
                            && key.eq_ignore_ascii_case(crate::workflow_mcp::BACKEND_URL_ENV))
                })
                .map(|(key, value)| (key.clone(), value.clone())),
        );
    }

    /// Return a new env with overrides applied. Overrides take precedence.
    pub fn with_overrides(mut self, overrides: &HashMap<String, String>) -> Self {
        self.merge(overrides);
        self
    }

    /// Return a new env with profile env from CmdOverrides merged in.
    pub fn with_profile(self, cmd: &CmdOverrides) -> Self {
        if let Some(ref profile_env) = cmd.env {
            self.with_overrides(profile_env)
        } else {
            self
        }
    }

    /// Apply all environment variables to a Command
    pub fn apply_to_command(&self, command: &mut Command) {
        // Ordinary/Node runs must not inherit a main Agent's authority merely
        // because the server itself inherited an environment from that process.
        crate::workflow_mcp::remove_inherited_context(command);
        for (key, value) in &self.vars {
            command.env(key, value);
        }
    }

    pub fn contains_key(&self, key: &str) -> bool {
        self.vars.contains_key(key)
    }

    pub fn get(&self, key: &str) -> Option<&String> {
        self.vars.get(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_overrides_runtime_env() {
        let mut base = ExecutionEnv::new(RepoContext::default(), false, String::new());
        base.insert("VK_PROJECT_NAME", "runtime");
        base.insert("FOO", "runtime");

        let mut profile = HashMap::new();
        profile.insert("FOO".to_string(), "profile".to_string());
        profile.insert("BAR".to_string(), "profile".to_string());

        let merged = base.with_overrides(&profile);

        assert_eq!(merged.vars.get("VK_PROJECT_NAME").unwrap(), "runtime");
        assert_eq!(merged.vars.get("FOO").unwrap(), "profile"); // overrides
        assert_eq!(merged.vars.get("BAR").unwrap(), "profile");
    }

    #[test]
    fn workflow_authority_is_not_profile_overridable_or_debugged() {
        let mut env = ExecutionEnv::new(RepoContext::default(), false, String::new());
        env.insert(crate::workflow_mcp::TOKEN_ENV, "scope-secret");
        env.insert(
            crate::workflow_mcp::BACKEND_URL_ENV,
            "http://127.0.0.1:3001",
        );
        let overrides = HashMap::from([
            (
                crate::workflow_mcp::TOKEN_ENV.to_owned(),
                "forged".to_owned(),
            ),
            (
                "mcp_workflow_token".to_owned(),
                "lowercase-forged".to_owned(),
            ),
            (
                crate::workflow_mcp::BACKEND_URL_ENV.to_owned(),
                "https://other.example".to_owned(),
            ),
        ]);
        let env = env.with_overrides(&overrides);
        assert_eq!(
            env.get(crate::workflow_mcp::TOKEN_ENV).unwrap(),
            "scope-secret"
        );
        assert_eq!(
            env.get(crate::workflow_mcp::BACKEND_URL_ENV).unwrap(),
            "http://127.0.0.1:3001"
        );
        assert!(!env.contains_key("mcp_workflow_token"));
        assert!(!format!("{env:?}").contains("scope-secret"));
        let ordinary = ExecutionEnv::new(RepoContext::default(), false, String::new())
            .with_overrides(&overrides);
        assert!(!ordinary.contains_key(crate::workflow_mcp::TOKEN_ENV));
    }

    #[test]
    fn workflow_authority_gemini_aliases_are_protected_and_not_debugged() {
        use crate::workflow_mcp::{
            BACKEND_URL_ENV, READY_ADDRESS_ENV, TOKEN_ENV, gemini_env_alias,
        };

        let mut env = ExecutionEnv::new(RepoContext::default(), false, String::new());
        let alias = gemini_env_alias(TOKEN_ENV);
        env.insert(TOKEN_ENV, "actual-scope-secret");
        env.insert(&alias, "actual-scope-secret");
        let overrides = HashMap::from([
            (alias.clone(), "forged".to_owned()),
            (alias.to_lowercase(), "lowercase-forged".to_owned()),
            (
                gemini_env_alias(BACKEND_URL_ENV),
                "https://other.example".to_owned(),
            ),
            (
                gemini_env_alias(READY_ADDRESS_ENV),
                "192.0.2.1:1234".to_owned(),
            ),
        ]);
        let protected = env.with_overrides(&overrides);
        assert_eq!(protected.get(&alias).unwrap(), "actual-scope-secret");
        assert!(!protected.contains_key(&alias.to_lowercase()));
        assert!(!protected.contains_key(&gemini_env_alias(BACKEND_URL_ENV)));
        assert!(!protected.contains_key(&gemini_env_alias(READY_ADDRESS_ENV)));
        assert!(!format!("{protected:?}").contains("actual-scope-secret"));
        let ordinary = ExecutionEnv::new(RepoContext::default(), false, String::new())
            .with_overrides(&overrides);
        assert!(ordinary.vars.is_empty());
    }

    #[test]
    fn workflow_authority_is_removed_from_ordinary_and_node_child_commands() {
        let env = ExecutionEnv::new(RepoContext::default(), false, String::new());
        let mut command = Command::new("unused-test-command");
        env.apply_to_command(&mut command);
        let removed = command
            .as_std()
            .get_envs()
            .filter(|(_, value)| value.is_none())
            .map(|(key, _)| key.to_string_lossy().into_owned())
            .collect::<std::collections::HashSet<_>>();
        for key in crate::workflow_mcp::all_context_env_keys() {
            assert!(
                removed.contains(&key),
                "reserved variable was inherited: {key}"
            );
        }
    }
}
