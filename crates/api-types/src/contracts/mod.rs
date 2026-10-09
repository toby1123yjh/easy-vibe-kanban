//! Source-owned public transport metadata, shared by servers and code generation.

pub mod mutations;
pub mod shape_definition;
pub mod shapes;

pub use shape_definition::{ShapeDefinition, ShapeExport};

#[cfg(test)]
mod tests {
    use super::shapes::*;

    #[test]
    fn task_shapes_separate_public_routes_from_physical_tables() {
        assert_eq!(PROJECT_TASKS_SHAPE.table, "issues");
        assert_eq!(PROJECT_TASKS_SHAPE.url, "/shape/project/{project_id}/tasks");
        assert_eq!(PROJECT_TASKS_SHAPE.fallback_url, "/fallback/tasks");
        assert_eq!(TASK_COMMENTS_SHAPE.params, ["task_id"]);
        assert_eq!(TASK_COMMENTS_SHAPE.table, "issue_comments");
        assert_eq!(all_shapes().len(), 17);
    }
}
