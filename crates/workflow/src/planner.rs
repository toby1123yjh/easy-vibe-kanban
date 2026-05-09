use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::graph::{WorkflowEdge, WorkflowGraph, WorkflowNode, WorkflowNodeKind};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodeExecutionSnapshot {
    pub node_id: String,
    pub status: NodeExecutionStatus,
    pub output_text: Option<String>,
    pub error_text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunSnapshot {
    pub run_id: String,
    pub nodes: Vec<NodeExecutionSnapshot>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReadyNode {
    pub node_id: String,
    pub kind: WorkflowNodeKind,
    pub writes_main_worktree: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlannerWarning {
    SerializedMainWorktreeAgents { node_ids: Vec<String> },
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ReadyPlan {
    pub ready_nodes: Vec<ReadyNode>,
    pub warnings: Vec<PlannerWarning>,
}

pub fn plan_ready_nodes(graph: &WorkflowGraph, snapshot: &RunSnapshot) -> ReadyPlan {
    let statuses = node_statuses(snapshot);
    let incoming = incoming_edges(graph);

    let mut ready_nodes = graph
        .nodes
        .iter()
        .filter(|node| node_status(node.id.as_str(), &statuses) == NodeExecutionStatus::Pending)
        .filter(|node| {
            node_is_ready(
                node,
                incoming.get(node.id.as_str()).map(Vec::as_slice),
                &statuses,
            )
        })
        .map(ready_node)
        .collect::<Vec<_>>();

    let mut warnings = Vec::new();
    serialize_main_worktree_agents(graph, &statuses, &mut ready_nodes, &mut warnings);

    ReadyPlan {
        ready_nodes,
        warnings,
    }
}

fn node_status(
    node_id: &str,
    statuses: &HashMap<&str, NodeExecutionStatus>,
) -> NodeExecutionStatus {
    statuses
        .get(node_id)
        .copied()
        .unwrap_or(NodeExecutionStatus::Pending)
}

fn node_statuses(snapshot: &RunSnapshot) -> HashMap<&str, NodeExecutionStatus> {
    snapshot
        .nodes
        .iter()
        .map(|node| (node.node_id.as_str(), node.status))
        .collect()
}

fn incoming_edges(graph: &WorkflowGraph) -> HashMap<&str, Vec<&WorkflowEdge>> {
    let mut incoming: HashMap<&str, Vec<&WorkflowEdge>> = graph
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), Vec::new()))
        .collect();

    for edge in &graph.edges {
        incoming.entry(edge.target.as_str()).or_default().push(edge);
    }

    incoming
}

fn node_is_ready(
    node: &WorkflowNode,
    incoming: Option<&[&WorkflowEdge]>,
    statuses: &HashMap<&str, NodeExecutionStatus>,
) -> bool {
    let Some(incoming) = incoming else {
        return node.kind == WorkflowNodeKind::Start;
    };
    if incoming.is_empty() {
        return node.kind == WorkflowNodeKind::Start;
    }

    let mut has_succeeded_upstream = false;
    for edge in incoming {
        match node_status(edge.source.as_str(), statuses) {
            NodeExecutionStatus::Succeeded => has_succeeded_upstream = true,
            NodeExecutionStatus::Skipped => {}
            NodeExecutionStatus::Pending
            | NodeExecutionStatus::Running
            | NodeExecutionStatus::AwaitingHuman
            | NodeExecutionStatus::AwaitingArena
            | NodeExecutionStatus::Failed => return false,
        }
    }

    has_succeeded_upstream
}

fn ready_node(node: &WorkflowNode) -> ReadyNode {
    ReadyNode {
        node_id: node.id.clone(),
        kind: node.kind.clone(),
        writes_main_worktree: node.kind == WorkflowNodeKind::Agent,
    }
}

fn serialize_main_worktree_agents(
    graph: &WorkflowGraph,
    statuses: &HashMap<&str, NodeExecutionStatus>,
    ready_nodes: &mut Vec<ReadyNode>,
    warnings: &mut Vec<PlannerWarning>,
) {
    let agent_node_ids = ready_nodes
        .iter()
        .filter(|node| node.writes_main_worktree)
        .map(|node| node.node_id.clone())
        .collect::<Vec<_>>();
    if agent_node_ids.is_empty() {
        return;
    }

    let agent_is_running = graph.nodes.iter().any(|node| {
        node.kind == WorkflowNodeKind::Agent
            && node_status(node.id.as_str(), statuses) == NodeExecutionStatus::Running
    });

    if agent_is_running {
        ready_nodes.retain(|node| !node.writes_main_worktree);
        warnings.push(PlannerWarning::SerializedMainWorktreeAgents {
            node_ids: agent_node_ids,
        });
        return;
    }

    if agent_node_ids.len() <= 1 {
        return;
    }

    let selected_agent_id = agent_node_ids[0].as_str();
    ready_nodes
        .retain(|node| !node.writes_main_worktree || node.node_id.as_str() == selected_agent_id);
    warnings.push(PlannerWarning::SerializedMainWorktreeAgents {
        node_ids: agent_node_ids,
    });
}

#[cfg(test)]
mod tests {
    use crate::{
        graph::{
            WorkflowEdge, WorkflowEdgeKind, WorkflowGraph, WorkflowNode, WorkflowNodeData,
            WorkflowNodeKind,
        },
        planner::{
            NodeExecutionSnapshot, NodeExecutionStatus, PlannerWarning, RunSnapshot,
            plan_ready_nodes,
        },
    };

    fn node(id: &str, kind: WorkflowNodeKind) -> WorkflowNode {
        WorkflowNode {
            id: id.to_string(),
            kind,
            data: WorkflowNodeData::default(),
        }
    }

    fn edge(id: &str, source: &str, target: &str) -> WorkflowEdge {
        WorkflowEdge {
            id: id.to_string(),
            source: source.to_string(),
            target: target.to_string(),
            kind: WorkflowEdgeKind::Default,
        }
    }

    fn graph(nodes: Vec<WorkflowNode>, edges: Vec<WorkflowEdge>) -> WorkflowGraph {
        WorkflowGraph {
            version: 1,
            nodes,
            edges,
        }
    }

    fn snapshot(nodes: &[(&str, NodeExecutionStatus)]) -> RunSnapshot {
        RunSnapshot {
            run_id: "run-1".to_string(),
            nodes: nodes
                .iter()
                .map(|(node_id, status)| NodeExecutionSnapshot {
                    node_id: (*node_id).to_string(),
                    status: *status,
                    output_text: None,
                    error_text: None,
                })
                .collect(),
        }
    }

    #[test]
    fn start_is_ready_first() {
        let graph = graph(
            vec![
                node("start", WorkflowNodeKind::Start),
                node("end", WorkflowNodeKind::End),
            ],
            vec![edge("e1", "start", "end")],
        );

        let plan = plan_ready_nodes(&graph, &snapshot(&[]));

        assert_eq!(
            plan.ready_nodes
                .iter()
                .map(|node| node.node_id.as_str())
                .collect::<Vec<_>>(),
            vec!["start"]
        );
    }

    #[test]
    fn downstream_node_becomes_ready_after_upstream_succeeds() {
        let graph = graph(
            vec![
                node("start", WorkflowNodeKind::Start),
                node("agent", WorkflowNodeKind::Agent),
                node("end", WorkflowNodeKind::End),
            ],
            vec![edge("e1", "start", "agent"), edge("e2", "agent", "end")],
        );

        let plan = plan_ready_nodes(
            &graph,
            &snapshot(&[("start", NodeExecutionStatus::Succeeded)]),
        );

        assert_eq!(plan.ready_nodes[0].node_id, "agent");
    }

    #[test]
    fn join_waits_for_all_selected_upstream_nodes() {
        let graph = graph(
            vec![
                node("start", WorkflowNodeKind::Start),
                node("a", WorkflowNodeKind::Transform),
                node("b", WorkflowNodeKind::Transform),
                node("join", WorkflowNodeKind::Agent),
                node("end", WorkflowNodeKind::End),
            ],
            vec![
                edge("e1", "start", "a"),
                edge("e2", "start", "b"),
                edge("e3", "a", "join"),
                edge("e4", "b", "join"),
                edge("e5", "join", "end"),
            ],
        );

        let waiting = plan_ready_nodes(
            &graph,
            &snapshot(&[
                ("start", NodeExecutionStatus::Succeeded),
                ("a", NodeExecutionStatus::Succeeded),
            ]),
        );
        assert!(
            waiting
                .ready_nodes
                .iter()
                .all(|node| node.node_id != "join")
        );

        let ready = plan_ready_nodes(
            &graph,
            &snapshot(&[
                ("start", NodeExecutionStatus::Succeeded),
                ("a", NodeExecutionStatus::Succeeded),
                ("b", NodeExecutionStatus::Succeeded),
            ]),
        );
        assert_eq!(ready.ready_nodes[0].node_id, "join");
    }

    #[test]
    fn skipped_branch_unblocks_join_when_another_upstream_succeeded() {
        let graph = graph(
            vec![
                node("start", WorkflowNodeKind::Start),
                node("selected", WorkflowNodeKind::Transform),
                node("skipped", WorkflowNodeKind::Transform),
                node("join", WorkflowNodeKind::Agent),
                node("end", WorkflowNodeKind::End),
            ],
            vec![
                edge("e1", "start", "selected"),
                edge("e2", "start", "skipped"),
                edge("e3", "selected", "join"),
                edge("e4", "skipped", "join"),
                edge("e5", "join", "end"),
            ],
        );

        let plan = plan_ready_nodes(
            &graph,
            &snapshot(&[
                ("start", NodeExecutionStatus::Succeeded),
                ("selected", NodeExecutionStatus::Succeeded),
                ("skipped", NodeExecutionStatus::Skipped),
            ]),
        );

        assert_eq!(plan.ready_nodes[0].node_id, "join");
    }

    #[test]
    fn skipped_only_upstream_does_not_make_node_ready() {
        let graph = graph(
            vec![
                node("start", WorkflowNodeKind::Start),
                node("skipped", WorkflowNodeKind::Transform),
                node("downstream", WorkflowNodeKind::Agent),
                node("end", WorkflowNodeKind::End),
            ],
            vec![
                edge("e1", "start", "skipped"),
                edge("e2", "skipped", "downstream"),
                edge("e3", "downstream", "end"),
            ],
        );

        let plan = plan_ready_nodes(
            &graph,
            &snapshot(&[
                ("start", NodeExecutionStatus::Succeeded),
                ("skipped", NodeExecutionStatus::Skipped),
            ]),
        );

        assert!(plan.ready_nodes.is_empty());
    }

    #[test]
    fn multiple_ready_agent_nodes_on_main_worktree_are_serialized() {
        let graph = graph(
            vec![
                node("start", WorkflowNodeKind::Start),
                node("agent-a", WorkflowNodeKind::Agent),
                node("agent-b", WorkflowNodeKind::Agent),
                node("end", WorkflowNodeKind::End),
            ],
            vec![
                edge("e1", "start", "agent-a"),
                edge("e2", "start", "agent-b"),
                edge("e3", "agent-a", "end"),
                edge("e4", "agent-b", "end"),
            ],
        );

        let plan = plan_ready_nodes(
            &graph,
            &snapshot(&[("start", NodeExecutionStatus::Succeeded)]),
        );

        assert_eq!(plan.ready_nodes.len(), 1);
        assert_eq!(plan.ready_nodes[0].node_id, "agent-a");
        assert_eq!(
            plan.warnings,
            vec![PlannerWarning::SerializedMainWorktreeAgents {
                node_ids: vec!["agent-a".to_string(), "agent-b".to_string()]
            }]
        );
    }
}
