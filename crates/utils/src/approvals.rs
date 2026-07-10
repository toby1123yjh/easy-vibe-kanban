use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

pub const APPROVAL_TIMEOUT_SECONDS: i64 = 36000; // 10 hours

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ApprovalRequest {
    pub id: String,
    pub tool_name: String,
    pub execution_process_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub timeout_at: DateTime<Utc>,
}

impl ApprovalRequest {
    pub fn new(tool_name: String, execution_process_id: Uuid) -> Self {
        Self::new_with_timeout(tool_name, execution_process_id, None)
    }

    pub fn new_with_timeout(
        tool_name: String,
        execution_process_id: Uuid,
        timeout: Option<std::time::Duration>,
    ) -> Self {
        let now = Utc::now();
        let timeout = timeout
            .and_then(|timeout| Duration::from_std(timeout).ok())
            .unwrap_or_else(|| Duration::seconds(APPROVAL_TIMEOUT_SECONDS));
        Self {
            id: Uuid::new_v4().to_string(),
            tool_name,
            execution_process_id,
            created_at: now,
            timeout_at: now + timeout,
        }
    }
}

/// Status of a tool permission request (approve/deny for tool execution).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Denied {
        #[ts(optional)]
        reason: Option<String>,
    },
    TimedOut,
}

/// A question–answer pair. `answer` holds one or more selected labels/values.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct QuestionAnswer {
    pub question: String,
    pub answer: Vec<String>,
}

/// Status of a question answer request.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum QuestionStatus {
    Answered { answers: Vec<QuestionAnswer> },
    TimedOut,
}

// Tracks both approval and question answers requests
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ApprovalOutcome {
    Approved,
    Denied {
        #[ts(optional)]
        reason: Option<String>,
    },
    Answered {
        answers: Vec<QuestionAnswer>,
    },
    TimedOut,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ApprovalResponse {
    pub execution_process_id: Uuid,
    pub status: ApprovalOutcome,
}

#[cfg(test)]
mod tests {
    use std::time::Duration as StdDuration;

    use super::*;

    #[test]
    fn approval_request_uses_default_timeout() {
        let request = ApprovalRequest::new("bash".to_string(), Uuid::new_v4());

        assert_eq!(
            request.timeout_at - request.created_at,
            Duration::seconds(APPROVAL_TIMEOUT_SECONDS)
        );
    }

    #[test]
    fn provider_timeout_overrides_default_timeout() {
        let request = ApprovalRequest::new_with_timeout(
            "question".to_string(),
            Uuid::new_v4(),
            Some(StdDuration::from_millis(1_250)),
        );

        assert_eq!(
            request.timeout_at - request.created_at,
            Duration::milliseconds(1_250)
        );
    }
}
