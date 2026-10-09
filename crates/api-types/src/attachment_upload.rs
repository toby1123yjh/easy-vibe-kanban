use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::AttachmentWithBlob;

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct InitUploadRequest {
    pub project_id: Uuid,
    pub filename: String,
    #[ts(type = "number")]
    pub size_bytes: i64,
    pub hash: String,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct InitUploadResponse {
    pub upload_url: String,
    pub upload_id: Uuid,
    pub expires_at: DateTime<Utc>,
    pub skip_upload: bool,
    pub existing_blob_id: Option<Uuid>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct ConfirmUploadRequest {
    pub project_id: Uuid,
    pub upload_id: Uuid,
    pub filename: String,
    #[ts(optional)]
    pub content_type: Option<String>,
    #[ts(type = "number")]
    pub size_bytes: i64,
    pub hash: String,
    #[ts(optional)]
    #[serde(rename = "task_id")]
    #[ts(rename = "task_id")]
    pub issue_id: Option<Uuid>,
    #[ts(optional)]
    pub comment_id: Option<Uuid>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct CommitAttachmentsRequest {
    pub attachment_ids: Vec<Uuid>,
}

#[derive(Debug, Serialize, Deserialize, TS)]
pub struct CommitAttachmentsResponse {
    pub attachments: Vec<AttachmentWithBlob>,
}
