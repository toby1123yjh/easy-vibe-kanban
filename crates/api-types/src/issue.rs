use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::Type;
use ts_rs::TS;
use uuid::Uuid;

use crate::some_if_present;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, TS)]
#[sqlx(type_name = "issue_priority", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum TaskPriority {
    Urgent,
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, sqlx::FromRow)]
pub struct Task {
    pub id: Uuid,
    pub project_id: Uuid,
    #[serde(rename = "task_number")]
    #[ts(rename = "task_number")]
    pub issue_number: i32,
    pub simple_id: String,
    pub status_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub priority: Option<TaskPriority>,
    pub start_date: Option<DateTime<Utc>>,
    pub target_date: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub sort_order: f64,
    #[serde(rename = "parent_task_id")]
    #[ts(rename = "parent_task_id")]
    pub parent_issue_id: Option<Uuid>,
    #[serde(rename = "parent_task_sort_order")]
    #[ts(rename = "parent_task_sort_order")]
    pub parent_issue_sort_order: Option<f64>,
    pub extension_metadata: Value,
    pub creator_user_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum TaskSortField {
    SortOrder,
    Priority,
    CreatedAt,
    UpdatedAt,
    Title,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CreateTaskRequest {
    /// Optional client-generated ID. If not provided, server generates one.
    /// Using client-generated IDs enables stable optimistic updates.
    #[ts(optional)]
    pub id: Option<Uuid>,
    pub project_id: Uuid,
    pub status_id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub priority: Option<TaskPriority>,
    pub start_date: Option<DateTime<Utc>>,
    pub target_date: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub sort_order: f64,
    #[serde(rename = "parent_task_id")]
    #[ts(rename = "parent_task_id")]
    pub parent_issue_id: Option<Uuid>,
    #[serde(rename = "parent_task_sort_order")]
    #[ts(rename = "parent_task_sort_order")]
    pub parent_issue_sort_order: Option<f64>,
    pub extension_metadata: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UpdateTaskRequest {
    #[serde(
        default,
        deserialize_with = "some_if_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub status_id: Option<Uuid>,
    #[serde(
        default,
        deserialize_with = "some_if_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub title: Option<String>,
    #[serde(
        default,
        deserialize_with = "some_if_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub description: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "some_if_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub priority: Option<Option<TaskPriority>>,
    #[serde(
        default,
        deserialize_with = "some_if_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub start_date: Option<Option<DateTime<Utc>>>,
    #[serde(
        default,
        deserialize_with = "some_if_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub target_date: Option<Option<DateTime<Utc>>>,
    #[serde(
        default,
        deserialize_with = "some_if_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub completed_at: Option<Option<DateTime<Utc>>>,
    #[serde(
        default,
        deserialize_with = "some_if_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub sort_order: Option<f64>,
    #[serde(
        default,
        deserialize_with = "some_if_present",
        skip_serializing_if = "Option::is_none"
    )]
    #[serde(rename = "parent_task_id")]
    #[ts(rename = "parent_task_id")]
    pub parent_issue_id: Option<Option<Uuid>>,
    #[serde(
        default,
        deserialize_with = "some_if_present",
        skip_serializing_if = "Option::is_none"
    )]
    #[serde(rename = "parent_task_sort_order")]
    #[ts(rename = "parent_task_sort_order")]
    pub parent_issue_sort_order: Option<Option<f64>>,
    #[serde(
        default,
        deserialize_with = "some_if_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub extension_metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ListTasksQuery {
    pub project_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct SearchTasksRequest {
    pub project_id: Uuid,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_id: Option<Uuid>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_ids: Option<Vec<Uuid>>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<TaskPriority>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "parent_task_id")]
    #[ts(rename = "parent_task_id")]
    pub parent_issue_id: Option<Uuid>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub simple_id: Option<String>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee_user_id: Option<Uuid>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag_id: Option<Uuid>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tag_ids: Option<Vec<Uuid>>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_field: Option<TaskSortField>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_direction: Option<SortDirection>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<i32>,
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ListTasksResponse {
    #[serde(rename = "tasks")]
    #[ts(rename = "tasks")]
    pub issues: Vec<Task>,
    pub total_count: usize,
    pub limit: usize,
    pub offset: usize,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn task_patch_preserves_omitted_and_explicitly_cleared_parent() {
        let omitted: UpdateTaskRequest = serde_json::from_value(json!({})).unwrap();
        assert_eq!(omitted.parent_issue_id, None);
        assert_eq!(serde_json::to_value(omitted).unwrap(), json!({}));

        let cleared: UpdateTaskRequest = serde_json::from_value(json!({
            "parent_task_id": null,
            "parent_task_sort_order": null,
            "description": null
        }))
        .unwrap();
        assert_eq!(cleared.parent_issue_id, Some(None));
        assert_eq!(cleared.parent_issue_sort_order, Some(None));
        assert_eq!(cleared.description, Some(None));
        let encoded = serde_json::to_value(cleared).unwrap();
        assert_eq!(
            encoded,
            json!({
                "parent_task_id": null,
                "parent_task_sort_order": null,
                "description": null
            })
        );
    }

    #[test]
    fn task_wire_and_typescript_contracts_use_business_names() {
        let parent = Uuid::new_v4();
        let request: UpdateTaskRequest = serde_json::from_value(json!({
            "parent_task_id": parent
        }))
        .unwrap();
        assert_eq!(request.parent_issue_id, Some(Some(parent)));
        let declaration = Task::decl();
        assert!(declaration.contains("task_number"));
        assert!(declaration.contains("parent_task_id"));
        assert!(!declaration.contains("issue_number"));
        assert!(!declaration.contains("parent_issue_id"));
        let page = ListTasksResponse {
            issues: Vec::new(),
            total_count: 0,
            limit: 50,
            offset: 0,
        };
        let encoded = serde_json::to_value(page).unwrap();
        assert_eq!(encoded["tasks"], json!([]));
        assert!(encoded.get("issues").is_none());
    }
}
