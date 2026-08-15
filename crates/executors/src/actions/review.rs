use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, TS)]
pub struct RepoReviewContext {
    pub repo_id: Uuid,
    pub repo_name: String,
    pub base_commit: String,
}
