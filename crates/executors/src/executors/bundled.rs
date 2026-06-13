//! Pin & ship: resolve coding-agent CLIs bundled by the npx wrapper.
//!
//! The npx package pins `@openai/codex` and `@anthropic-ai/claude-code` as
//! dependencies and exposes their resolved launch commands through the
//! environment variables below, so executors spawn a known-good agent version
//! instead of whatever happens to be on the user's PATH. When the variables
//! are absent (e.g. local development) executors fall back to PATH lookups.

/// Full command line for the bundled Claude Code CLI (quoted, shell-words style).
pub const BUNDLED_CLAUDE_CMD_ENV: &str = "VK_BUNDLED_CLAUDE_CMD";
/// Full command line for the bundled Codex CLI (quoted, shell-words style).
pub const BUNDLED_CODEX_CMD_ENV: &str = "VK_BUNDLED_CODEX_CMD";
/// Version of the bundled `@openai/codex` package.
pub const BUNDLED_CODEX_VERSION_ENV: &str = "VK_BUNDLED_CODEX_VERSION";
/// Truthy value opts out of bundled agents in favour of PATH lookups.
pub const USE_SYSTEM_AGENTS_ENV: &str = "VK_USE_SYSTEM_AGENTS";

fn is_truthy(value: &str) -> bool {
    let v = value.trim().to_ascii_lowercase();
    !v.is_empty() && v != "0" && v != "false" && v != "no" && v != "off"
}

/// Whether the user opted out of bundled agents entirely.
pub fn use_system_agents() -> bool {
    std::env::var(USE_SYSTEM_AGENTS_ENV)
        .map(|v| is_truthy(&v))
        .unwrap_or(false)
}

fn bundled_command(env_var: &str) -> Option<String> {
    if use_system_agents() {
        return None;
    }
    std::env::var(env_var)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn bundled_claude_command() -> Option<String> {
    bundled_command(BUNDLED_CLAUDE_CMD_ENV)
}

pub fn bundled_codex_command() -> Option<String> {
    bundled_command(BUNDLED_CODEX_CMD_ENV)
}

pub fn bundled_codex_version() -> Option<String> {
    if use_system_agents() {
        return None;
    }
    std::env::var(BUNDLED_CODEX_VERSION_ENV)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::is_truthy;

    #[test]
    fn truthy_values() {
        for v in ["1", "true", "TRUE", "yes", "on"] {
            assert!(is_truthy(v), "{v} should be truthy");
        }
        for v in ["", "0", "false", "no", "off", " OFF "] {
            assert!(!is_truthy(v), "{v} should be falsy");
        }
    }
}
