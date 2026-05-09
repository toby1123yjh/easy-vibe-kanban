#[cfg(test)]
mod tests {
    use crate::validation::validate_graph;

    use super::*;

    #[test]
    fn built_in_templates_are_valid() {
        for template in built_in_templates() {
            validate_graph(&template.graph).expect(template.name);
        }
    }

    #[test]
    fn role_templates_include_required_v1_roles() {
        let ids: Vec<_> = role_templates().iter().map(|role| role.id).collect();

        assert!(ids.contains(&"architect"));
        assert!(ids.contains(&"researcher"));
        assert!(ids.contains(&"implementer"));
        assert!(ids.contains(&"reviewer"));
        assert!(ids.contains(&"fixer"));
        assert!(ids.contains(&"custom"));
    }
}
