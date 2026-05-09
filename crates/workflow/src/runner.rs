use crate::{
    graph::WorkflowGraph,
    planner::{ReadyPlan, RunSnapshot, plan_ready_nodes},
};

#[derive(Debug, Clone)]
pub struct WorkflowRunner {
    graph: WorkflowGraph,
}

impl WorkflowRunner {
    pub fn from_graph(graph: WorkflowGraph) -> Self {
        Self { graph }
    }

    pub fn ready_plan(&self, snapshot: &RunSnapshot) -> ReadyPlan {
        plan_ready_nodes(&self.graph, snapshot)
    }
}
