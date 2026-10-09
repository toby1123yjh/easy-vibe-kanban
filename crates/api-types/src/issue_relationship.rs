use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use sqlx::Type;
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type, TS, JsonSchema)]
#[sqlx(type_name = "issue_relationship_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum TaskRelationshipType {
    Blocking,
    Related,
    HasDuplicate,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TaskRelationship {
    pub id: Uuid,
    #[serde(rename = "task_id")]
    #[ts(rename = "task_id")]
    pub issue_id: Uuid,
    #[serde(rename = "related_task_id")]
    #[ts(rename = "related_task_id")]
    pub related_issue_id: Uuid,
    pub relationship_type: TaskRelationshipType,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CreateTaskRelationshipRequest {
    /// Optional client-generated ID. If not provided, server generates one.
    /// Using client-generated IDs enables stable optimistic updates.
    #[ts(optional)]
    pub id: Option<Uuid>,
    #[serde(rename = "task_id")]
    #[ts(rename = "task_id")]
    pub issue_id: Uuid,
    #[serde(rename = "related_task_id")]
    #[ts(rename = "related_task_id")]
    pub related_issue_id: Uuid,
    pub relationship_type: TaskRelationshipType,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListTaskRelationshipsQuery {
    #[serde(rename = "task_id")]
    pub issue_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ListTaskRelationshipsResponse {
    #[serde(rename = "task_relationships")]
    #[ts(rename = "task_relationships")]
    pub issue_relationships: Vec<TaskRelationship>,
}
