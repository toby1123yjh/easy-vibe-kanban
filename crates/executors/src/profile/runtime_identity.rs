/// Compare persisted runtime profile identities without changing their spelling.
/// An omitted variant resolves to the exact `DEFAULT` preset in profile lookup.
/// Other variants and provider names remain case-sensitive and distinct.
pub fn runtime_profile_ids_match(left: &str, right: &str) -> bool {
    fn default_identity(id: &str) -> &str {
        match id.split_once(':') {
            Some((provider, "DEFAULT")) if !provider.is_empty() => provider,
            _ => id,
        }
    }

    default_identity(left) == default_identity(right)
}

#[cfg(test)]
mod tests {
    use super::runtime_profile_ids_match;

    #[test]
    fn explicit_and_omitted_default_are_the_same_profile() {
        for provider in ["CODEX", "CLAUDE_CODE", "GEMINI", "OH_MY_PI"] {
            let explicit = format!("{provider}:DEFAULT");
            assert!(runtime_profile_ids_match(provider, &explicit));
            assert!(runtime_profile_ids_match(&explicit, provider));
            assert!(runtime_profile_ids_match(&explicit, &explicit));
        }
    }

    #[test]
    fn different_profiles_remain_distinct() {
        for (left, right) in [
            ("CODEX:DEFAULT", "CLAUDE_CODE"),
            ("CODEX", "CODEX:PLAN"),
            ("CODEX:PLAN", "CODEX:DEFAULT"),
            ("CODEX:PLAN", "CODEX:REVIEW"),
            ("CODEX:default", "CODEX"),
            ("CODEX:", "CODEX"),
            ("CODEX:PLAN:DEFAULT", "CODEX:PLAN"),
        ] {
            assert!(!runtime_profile_ids_match(left, right), "{left} != {right}");
        }
        assert!(runtime_profile_ids_match("CODEX:PLAN", "CODEX:PLAN"));
    }
}
