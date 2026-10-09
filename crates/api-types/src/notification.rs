use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::Type;
use ts_rs::TS;
use uuid::Uuid;

use crate::{TaskPriority, some_if_present};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, TS)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "notification_type", rename_all = "snake_case")]
pub enum NotificationType {
    #[sqlx(rename = "issue_comment_added")]
    TaskCommentAdded,
    #[sqlx(rename = "issue_status_changed")]
    TaskStatusChanged,
    #[sqlx(rename = "issue_assignee_changed")]
    TaskAssigneeChanged,
    #[sqlx(rename = "issue_priority_changed")]
    TaskPriorityChanged,
    #[sqlx(rename = "issue_unassigned")]
    TaskUnassigned,
    #[sqlx(rename = "issue_comment_reaction")]
    TaskCommentReaction,
    #[sqlx(rename = "issue_deleted")]
    TaskDeleted,
    #[sqlx(rename = "issue_title_changed")]
    TaskTitleChanged,
    #[sqlx(rename = "issue_description_changed")]
    TaskDescriptionChanged,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum NotificationGroupKind {
    Single,
    TaskChanges,
    StatusChanges,
    Comments,
    Reactions,
    TaskDeleted,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Notification {
    pub id: Uuid,
    pub organization_id: Uuid,
    pub user_id: Uuid,
    pub notification_type: NotificationType,
    pub payload: NotificationPayload,
    #[serde(rename = "task_id")]
    #[ts(rename = "task_id")]
    pub issue_id: Option<Uuid>,
    pub comment_id: Option<Uuid>,
    pub seen: bool,
    pub dismissed_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
pub struct NotificationPayload {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deeplink_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    // Existing PostgreSQL JSONB payloads retain their original field names.
    // Read those records without emitting legacy names in new API responses.
    #[serde(rename = "task_id", alias = "issue_id")]
    #[ts(rename = "task_id")]
    pub issue_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(rename = "task_simple_id", alias = "issue_simple_id")]
    #[ts(rename = "task_simple_id")]
    pub issue_simple_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(rename = "task_title", alias = "issue_title")]
    #[ts(rename = "task_title")]
    pub issue_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor_user_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment_preview: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_status_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_status_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_status_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_status_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_priority: Option<TaskPriority>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_priority: Option<TaskPriority>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignee_user_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UpdateNotificationRequest {
    #[serde(default, deserialize_with = "some_if_present")]
    pub seen: Option<bool>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn historical_notification_payload_preserves_task_identity_and_title() {
        let id = Uuid::new_v4();
        let payload: NotificationPayload = serde_json::from_value(json!({
            "issue_id": id,
            "issue_simple_id": "ISSUE-42",
            "issue_title": "Existing authored task",
            "comment_preview": "Existing discussion"
        }))
        .unwrap();

        assert_eq!(payload.issue_id, Some(id));
        assert_eq!(payload.issue_simple_id.as_deref(), Some("ISSUE-42"));
        assert_eq!(
            payload.issue_title.as_deref(),
            Some("Existing authored task")
        );
        let encoded = serde_json::to_value(payload).unwrap();
        assert_eq!(encoded["task_id"], json!(id));
        assert_eq!(encoded["task_simple_id"], "ISSUE-42");
        assert_eq!(encoded["task_title"], "Existing authored task");
        assert_eq!(encoded["comment_preview"], "Existing discussion");
        assert!(encoded.get("issue_id").is_none());
        assert!(encoded.get("issue_simple_id").is_none());
        assert!(encoded.get("issue_title").is_none());

        let restored: NotificationPayload = serde_json::from_value(encoded).unwrap();
        assert_eq!(restored.issue_id, Some(id));
        assert_eq!(
            restored.issue_title.as_deref(),
            Some("Existing authored task")
        );
    }
}
