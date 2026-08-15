use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// A native provider session discovered from the provider's own history.
///
/// This DTO intentionally has no database identity. Native resume discovery
/// reads provider-owned files and returns only the fields needed by the
/// picker; AgentRun/RunAttempt remains the source of truth for product runs.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ResumableAgentSession {
    pub agent_session_id: String,
    pub title: String,
    pub last_used_at: DateTime<Utc>,
}
