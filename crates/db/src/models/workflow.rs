use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, Type};
use ts_rs::TS;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "workflow_source", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
pub enum WorkflowSource {
    System,
    Project,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "workflow_run_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum WorkflowRunStatus {
    #[default]
    Pending,
    Running,
    AwaitingHuman,
    AwaitingArena,
    Succeeded,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "workflow_attempt_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum WorkflowAttemptStatus {
    #[default]
    Draft,
    Ready,
    Running,
    AwaitingHuman,
    AwaitingArena,
    Succeeded,
    Failed,
    Canceled,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Type, Serialize, Deserialize, TS)]
#[sqlx(type_name = "node_execution_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
#[ts(rename_all = "snake_case")]
pub enum NodeExecutionStatus {
    #[default]
    Pending,
    Running,
    AwaitingHuman,
    AwaitingArena,
    Succeeded,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct Workflow {
    pub id: Uuid,
    pub source: WorkflowSource,
    pub project_id: Option<Uuid>,
    pub name: String,
    pub description: Option<String>,
    pub graph_json: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkflowRun {
    pub id: Uuid,
    pub workflow_id: Uuid,
    pub attempt_id: Option<Uuid>,
    pub issue_id: Uuid,
    pub workspace_id: Option<Uuid>,
    pub trigger_source: String,
    pub input_text: String,
    pub output_text: Option<String>,
    pub status: WorkflowRunStatus,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub error_text: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct WorkflowAttempt {
    pub id: Uuid,
    pub project_id: Uuid,
    pub issue_id: Uuid,
    pub workflow_id: Uuid,
    pub latest_run_id: Option<Uuid>,
    pub workspace_id: Option<Uuid>,
    pub name: String,
    pub status: WorkflowAttemptStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct NodeExecution {
    pub id: Uuid,
    pub run_id: Uuid,
    pub node_id: String,
    pub node_type: String,
    pub iteration: i64,
    pub status: NodeExecutionStatus,
    pub input_text: Option<String>,
    pub output_text: Option<String>,
    pub session_id: Option<Uuid>,
    pub execution_process_id: Option<Uuid>,
    pub arena_group_id: Option<Uuid>,
    pub tokens_used: Option<i64>,
    pub cost_estimate: Option<f64>,
    pub started_at: Option<DateTime<Utc>>,
    pub finished_at: Option<DateTime<Utc>>,
    pub error_text: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateWorkflow {
    pub source: WorkflowSource,
    pub project_id: Option<Uuid>,
    pub name: String,
    pub description: Option<String>,
    pub graph_json: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UpdateWorkflow {
    pub name: Option<String>,
    pub description: Option<String>,
    pub graph_json: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateWorkflowRun {
    pub workflow_id: Uuid,
    pub attempt_id: Option<Uuid>,
    pub issue_id: Uuid,
    pub workspace_id: Option<Uuid>,
    pub trigger_source: String,
    pub input_text: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateWorkflowAttempt {
    pub project_id: Uuid,
    pub issue_id: Uuid,
    pub workflow_id: Uuid,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UpdateWorkflowAttemptRuntime {
    pub latest_run_id: Option<Uuid>,
    pub workspace_id: Option<Uuid>,
    pub status: WorkflowAttemptStatus,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UpdateWorkflowRunStatus {
    pub status: WorkflowRunStatus,
    pub output_text: Option<String>,
    pub error_text: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct CreateNodeExecution {
    pub run_id: Uuid,
    pub node_id: String,
    pub node_type: String,
    pub iteration: i64,
    pub status: NodeExecutionStatus,
    pub input_text: Option<String>,
}

#[derive(Debug, Clone, Deserialize, TS)]
pub struct UpdateNodeExecution {
    pub status: NodeExecutionStatus,
    pub input_text: Option<String>,
    pub output_text: Option<String>,
    pub session_id: Option<Uuid>,
    pub execution_process_id: Option<Uuid>,
    pub arena_group_id: Option<Uuid>,
    pub tokens_used: Option<i64>,
    pub cost_estimate: Option<f64>,
    pub error_text: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workflow_run_status_serializes_with_snake_case_names() {
        assert_eq!(
            serde_json::to_string(&WorkflowRunStatus::AwaitingHuman).unwrap(),
            r#""awaiting_human""#
        );
    }

    #[test]
    fn workflow_attempt_status_serializes_with_snake_case_names() {
        assert_eq!(
            serde_json::to_string(&WorkflowAttemptStatus::AwaitingHuman).unwrap(),
            r#""awaiting_human""#
        );
    }

    #[test]
    fn node_execution_status_serializes_with_snake_case_names() {
        assert_eq!(
            serde_json::to_string(&NodeExecutionStatus::AwaitingArena).unwrap(),
            r#""awaiting_arena""#
        );
    }
}
