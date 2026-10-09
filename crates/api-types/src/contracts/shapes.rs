//! One source for runtime shape definitions and lightweight type generation.

#[macro_export]
macro_rules! for_each_shape_contract {
    ($declare:ident) => {
        $declare! {
            PROJECTS_SHAPE: $crate::Project {
                table: "projects",
                where_clause: r#""organization_id" = $1"#,
                url: "/shape/projects",
                fallback_url: "/fallback/projects",
                params: ["organization_id"],
            }
            NOTIFICATIONS_SHAPE: $crate::Notification {
                table: "notifications",
                where_clause: r#""user_id" = $1"#,
                url: "/shape/notifications",
                fallback_url: "/fallback/notifications",
                params: ["user_id"],
            }
            ORGANIZATION_MEMBERS_SHAPE: $crate::OrganizationMember {
                table: "organization_member_metadata",
                where_clause: r#""organization_id" = $1"#,
                url: "/shape/organization_members",
                fallback_url: "/fallback/organization_members",
                params: ["organization_id"],
            }
            USERS_SHAPE: $crate::User {
                table: "users",
                where_clause: r#""id" IN (SELECT user_id FROM organization_member_metadata WHERE "organization_id" = $1)"#,
                url: "/shape/users",
                fallback_url: "/fallback/users",
                params: ["organization_id"],
            }
            PROJECT_TAGS_SHAPE: $crate::Tag {
                table: "tags",
                where_clause: r#""project_id" = $1"#,
                url: "/shape/project/{project_id}/tags",
                fallback_url: "/fallback/tags",
                params: ["project_id"],
            }
            PROJECT_PROJECT_STATUSES_SHAPE: $crate::ProjectStatus {
                table: "project_statuses",
                where_clause: r#""project_id" = $1"#,
                url: "/shape/project/{project_id}/project_statuses",
                fallback_url: "/fallback/project_statuses",
                params: ["project_id"],
            }
            PROJECT_TASKS_SHAPE: $crate::Task {
                table: "issues",
                where_clause: r#""project_id" = $1"#,
                url: "/shape/project/{project_id}/tasks",
                fallback_url: "/fallback/tasks",
                params: ["project_id"],
            }
            USER_WORKSPACES_SHAPE: $crate::Workspace {
                table: "workspaces",
                where_clause: r#""owner_user_id" = $1"#,
                url: "/shape/user/workspaces",
                fallback_url: "/fallback/user_workspaces",
                params: ["owner_user_id"],
            }
            PROJECT_WORKSPACES_SHAPE: $crate::Workspace {
                table: "workspaces",
                where_clause: r#""project_id" = $1"#,
                url: "/shape/project/{project_id}/workspaces",
                fallback_url: "/fallback/project_workspaces",
                params: ["project_id"],
            }
            PROJECT_TASK_ASSIGNEES_SHAPE: $crate::TaskAssignee {
                table: "issue_assignees",
                where_clause: r#""issue_id" IN (SELECT id FROM issues WHERE "project_id" = $1)"#,
                url: "/shape/project/{project_id}/task_assignees",
                fallback_url: "/fallback/task_assignees",
                params: ["project_id"],
            }
            PROJECT_TASK_FOLLOWERS_SHAPE: $crate::TaskFollower {
                table: "issue_followers",
                where_clause: r#""issue_id" IN (SELECT id FROM issues WHERE "project_id" = $1)"#,
                url: "/shape/project/{project_id}/task_followers",
                fallback_url: "/fallback/task_followers",
                params: ["project_id"],
            }
            PROJECT_TASK_TAGS_SHAPE: $crate::TaskTag {
                table: "issue_tags",
                where_clause: r#""issue_id" IN (SELECT id FROM issues WHERE "project_id" = $1)"#,
                url: "/shape/project/{project_id}/task_tags",
                fallback_url: "/fallback/task_tags",
                params: ["project_id"],
            }
            PROJECT_TASK_RELATIONSHIPS_SHAPE: $crate::TaskRelationship {
                table: "issue_relationships",
                where_clause: r#""issue_id" IN (SELECT id FROM issues WHERE "project_id" = $1)"#,
                url: "/shape/project/{project_id}/task_relationships",
                fallback_url: "/fallback/task_relationships",
                params: ["project_id"],
            }
            PROJECT_PULL_REQUESTS_SHAPE: $crate::PullRequest {
                table: "pull_requests",
                where_clause: r#""project_id" = $1"#,
                url: "/shape/project/{project_id}/pull_requests",
                fallback_url: "/fallback/pull_requests",
                params: ["project_id"],
            }
            PROJECT_PULL_REQUEST_TASKS_SHAPE: $crate::PullRequestTask {
                table: "pull_request_issues",
                where_clause: r#""issue_id" IN (SELECT id FROM issues WHERE "project_id" = $1)"#,
                url: "/shape/project/{project_id}/pull_request_tasks",
                fallback_url: "/fallback/pull_request_tasks",
                params: ["project_id"],
            }
            TASK_COMMENTS_SHAPE: $crate::TaskComment {
                table: "issue_comments",
                where_clause: r#""issue_id" = $1"#,
                url: "/shape/task/{task_id}/comments",
                fallback_url: "/fallback/task_comments",
                params: ["task_id"],
            }
            TASK_REACTIONS_SHAPE: $crate::TaskCommentReaction {
                table: "issue_comment_reactions",
                where_clause: r#""comment_id" IN (SELECT id FROM issue_comments WHERE "issue_id" = $1)"#,
                url: "/shape/task/{task_id}/reactions",
                fallback_url: "/fallback/task_comment_reactions",
                params: ["task_id"],
            }
        }
    };
}

macro_rules! declare_shapes {
    ($($name:ident: $row:ty {
        table: $table:literal, where_clause: $filter:literal,
        url: $url:literal, fallback_url: $fallback:literal,
        params: [$($param:literal),* $(,)?],
    })*) => {
        $(pub const $name: super::ShapeDefinition<$row> = super::ShapeDefinition {
            name: stringify!($name), table: $table, where_clause: $filter,
            url: $url, fallback_url: $fallback, params: &[$($param),*],
            _phantom: std::marker::PhantomData,
        };)*

        pub fn all_shapes() -> Vec<&'static dyn super::ShapeExport> {
            vec![$(&$name),*]
        }
    };
}

crate::for_each_shape_contract!(declare_shapes);
