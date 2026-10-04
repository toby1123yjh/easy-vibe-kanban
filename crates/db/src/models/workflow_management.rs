//! Durable workflow management bindings. Credentials are deliberately absent
//! from public/generated DTOs; only this private storage record has a verifier.
use chrono::{DateTime, Utc};
use sqlx::{FromRow, SqlitePool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow)]
pub struct WorkflowMainSessionBinding {
    pub session_id: Uuid,
    pub workflow_id: Uuid,
    pub prepared_issue_id: Option<Uuid>,
    pub main_agent_config_json: String,
    pub main_agent_prompt: String,
    pub token_hash: Option<String>,
    pub actual_main_agent_run_id: Option<Uuid>,
    pub actual_main_run_attempt_id: Option<Uuid>,
    pub actual_main_turn_id: Option<Uuid>,
    pub source_message_id: Option<Uuid>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl WorkflowMainSessionBinding {
    pub async fn find_by_session_id(
        pool: &SqlitePool,
        session_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as("SELECT session_id,workflow_id,prepared_issue_id,main_agent_config_json,main_agent_prompt,token_hash,actual_main_agent_run_id,actual_main_run_attempt_id,actual_main_turn_id,source_message_id,created_at,updated_at FROM workflow_main_session_bindings WHERE session_id=?")
            .bind(session_id).fetch_optional(pool).await
    }
}

#[derive(Debug, Clone, FromRow)]
pub struct WorkflowRunSubmission {
    pub run_id: Uuid,
    pub instance_id: Uuid,
    pub caller_namespace: String,
    pub request_id: String,
    pub request_hash: String,
    pub action: String,
    pub material_paths_json: String,
    pub scope_json: String,
    pub source_run_id: Option<Uuid>,
    pub source_node_execution_id: Option<Uuid>,
    pub source_message_id: Option<Uuid>,
    pub active_policy: Option<String>,
    pub affected_nodes_json: Option<String>,
    pub planning_state: String,
    pub created_at: DateTime<Utc>,
}

impl WorkflowRunSubmission {
    pub async fn find_by_run_id(
        pool: &SqlitePool,
        run_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as("SELECT * FROM workflow_run_submissions WHERE run_id=?")
            .bind(run_id)
            .fetch_optional(pool)
            .await
    }
}
