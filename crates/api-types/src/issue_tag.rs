use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct TaskTag {
    pub id: Uuid,
    #[serde(rename = "task_id")]
    #[ts(rename = "task_id")]
    pub issue_id: Uuid,
    pub tag_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CreateTaskTagRequest {
    /// Optional client-generated ID. If not provided, server generates one.
    /// Using client-generated IDs enables stable optimistic updates.
    #[ts(optional)]
    pub id: Option<Uuid>,
    #[serde(rename = "task_id")]
    #[ts(rename = "task_id")]
    pub issue_id: Uuid,
    pub tag_id: Uuid,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListTaskTagsQuery {
    #[serde(rename = "task_id")]
    pub issue_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ListTaskTagsResponse {
    #[serde(rename = "task_tags")]
    #[ts(rename = "task_tags")]
    pub issue_tags: Vec<TaskTag>,
}
