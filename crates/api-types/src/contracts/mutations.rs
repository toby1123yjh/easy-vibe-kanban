//! Typed REST resources. Runtime handlers and generated clients use these paths.

use ts_rs::TS;

use crate::*;

pub struct NoCreate;
pub struct NoUpdate;

pub trait MutationPayload {
    fn type_name() -> Option<String>;
}

impl<T: TS> MutationPayload for T {
    fn type_name() -> Option<String> {
        Some(T::name())
    }
}

impl MutationPayload for NoCreate {
    fn type_name() -> Option<String> {
        None
    }
}

impl MutationPayload for NoUpdate {
    fn type_name() -> Option<String> {
        None
    }
}

pub trait MutationEntity: TS {
    type Create: MutationPayload;
    type Update: MutationPayload;
    const PATH: &'static str;
}

#[derive(Debug, PartialEq, Eq)]
pub struct MutationDefinition {
    /// Public resource path, not the physical SQL table name.
    pub table: &'static str,
    pub row_type: String,
    pub create_type: Option<String>,
    pub update_type: Option<String>,
}

impl MutationDefinition {
    pub fn of<E: MutationEntity>() -> Self {
        Self {
            table: E::PATH,
            row_type: E::name(),
            create_type: E::Create::type_name(),
            update_type: E::Update::type_name(),
        }
    }
}

macro_rules! declare_mutations {
    ($($row:ty => ($path:literal, $create:ty, $update:ty)),* $(,)?) => {
        $(impl MutationEntity for $row {
            type Create = $create;
            type Update = $update;
            const PATH: &'static str = $path;
        })*

        pub fn all_mutation_definitions() -> Vec<MutationDefinition> {
            vec![$(MutationDefinition::of::<$row>()),*]
        }
    };
}

declare_mutations! {
    Project => ("projects", CreateProjectRequest, UpdateProjectRequest),
    Notification => ("notifications", NoCreate, UpdateNotificationRequest),
    Tag => ("tags", CreateTagRequest, UpdateTagRequest),
    ProjectStatus => ("project_statuses", CreateProjectStatusRequest, UpdateProjectStatusRequest),
    Task => ("tasks", CreateTaskRequest, UpdateTaskRequest),
    TaskAssignee => ("task_assignees", CreateTaskAssigneeRequest, NoUpdate),
    TaskFollower => ("task_followers", CreateTaskFollowerRequest, NoUpdate),
    TaskTag => ("task_tags", CreateTaskTagRequest, NoUpdate),
    TaskRelationship => ("task_relationships", CreateTaskRelationshipRequest, NoUpdate),
    TaskComment => ("task_comments", CreateTaskCommentRequest, UpdateTaskCommentRequest),
    TaskCommentReaction => ("task_comment_reactions", CreateTaskCommentReactionRequest, UpdateTaskCommentReactionRequest),
    PullRequestTask => ("pull_request_tasks", CreatePullRequestTaskRequest, NoUpdate),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn business_task_resource_has_no_issue_or_execution_alias() {
        let task = MutationDefinition::of::<Task>();
        assert_eq!(task.table, "tasks");
        assert_eq!(task.row_type, "Task");
        assert_eq!(task.create_type.as_deref(), Some("CreateTaskRequest"));
        let definitions = all_mutation_definitions();
        assert_eq!(definitions.len(), 12);
        assert!(
            definitions
                .iter()
                .all(|definition| !definition.table.contains("issue"))
        );
    }
}
