use crate::planner::{NodeExecutionStatus, RunSnapshot};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentExecutionRequest {
    pub run_id: String,
    pub node_id: String,
    pub prompt: String,
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentExecutionResult {
    pub output_text: String,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArenaCreationRequest {
    pub run_id: String,
    pub node_id: String,
    pub prompt: String,
    pub attempts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArenaCreationResult {
    pub arena_group_id: String,
}

pub trait WorkflowStore {
    type Error;

    fn load_run(&self, run_id: &str) -> Result<RunSnapshot, Self::Error>;
    fn save_node_status(
        &self,
        run_id: &str,
        node_id: &str,
        status: NodeExecutionStatus,
    ) -> Result<(), Self::Error>;
}

pub trait AgentExecutor {
    type Error;

    fn run_agent(
        &self,
        request: AgentExecutionRequest,
    ) -> Result<AgentExecutionResult, Self::Error>;
}

pub trait WorkflowWorkspaceFactory {
    type Error;

    fn create_or_bind_workspace(&self, run_id: &str) -> Result<String, Self::Error>;
}

pub trait WorkflowArenaFactory {
    type Error;

    fn create_arena(
        &self,
        request: ArenaCreationRequest,
    ) -> Result<ArenaCreationResult, Self::Error>;
}

pub trait WorkflowDiffApplier {
    type Error;

    fn apply_winner_diff(
        &self,
        run_id: &str,
        arena_group_id: &str,
        winner_workspace_id: &str,
    ) -> Result<(), Self::Error>;
}
