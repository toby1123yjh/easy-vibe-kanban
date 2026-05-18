use std::collections::{HashMap, HashSet};

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
    #[serde(default)]
    pub iteration: i64,
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
    pub iteration: i64,
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
    let executions = execution_snapshots(graph, snapshot);
    let succeeded_counts = succeeded_execution_counts(&executions);
    let incoming = incoming_edges(graph);
    let nodes_by_id = graph
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();

    let ready_nodes = executions
        .iter()
        .filter(|execution| execution.status == NodeExecutionStatus::Pending)
        .filter_map(|execution| {
            let node = nodes_by_id.get(execution.node_id.as_str())?;
            if execution_is_ready(
                node,
                execution.iteration,
                incoming.get(node.id.as_str()).map(Vec::as_slice),
                &succeeded_counts,
            ) {
                Some(ready_node(node, execution.iteration))
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    ReadyPlan {
        ready_nodes,
        warnings: Vec::new(),
    }
}

fn execution_snapshots(
    graph: &WorkflowGraph,
    snapshot: &RunSnapshot,
) -> Vec<NodeExecutionSnapshot> {
    let mut executions = snapshot.nodes.clone();
    let known_iteration_zero = executions
        .iter()
        .filter(|execution| execution.iteration == 0)
        .map(|execution| execution.node_id.clone())
        .collect::<HashSet<_>>();

    for node in &graph.nodes {
        if known_iteration_zero.contains(node.id.as_str()) {
            continue;
        }
        executions.push(NodeExecutionSnapshot {
            node_id: node.id.clone(),
            iteration: 0,
            status: NodeExecutionStatus::Pending,
            output_text: None,
            error_text: None,
        });
    }

    executions
}

fn succeeded_execution_counts(snapshot: &[NodeExecutionSnapshot]) -> HashMap<&str, i64> {
    let mut counts = HashMap::new();
    snapshot
        .iter()
        .filter(|node| node.status == NodeExecutionStatus::Succeeded)
        .for_each(|node| {
            *counts.entry(node.node_id.as_str()).or_insert(0) += 1;
        });
    counts
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

fn execution_is_ready(
    node: &WorkflowNode,
    iteration: i64,
    incoming: Option<&[&WorkflowEdge]>,
    succeeded_counts: &HashMap<&str, i64>,
) -> bool {
    let Some(incoming) = incoming else {
        return node.kind == WorkflowNodeKind::Start && iteration == 0;
    };
    if incoming.is_empty() {
        return node.kind == WorkflowNodeKind::Start && iteration == 0;
    }

    incoming.iter().any(|edge| {
        succeeded_counts
            .get(edge.source.as_str())
            .copied()
            .unwrap_or(0)
            > 0
    })
}

fn ready_node(node: &WorkflowNode, iteration: i64) -> ReadyNode {
    ReadyNode {
        node_id: node.id.clone(),
        iteration,
        kind: node.kind.clone(),
        writes_main_worktree: node.kind == WorkflowNodeKind::Agent,
    }
}

#[cfg(test)]
mod tests {
    use crate::{
        graph::{
            WorkflowEdge, WorkflowEdgeKind, WorkflowGraph, WorkflowNode, WorkflowNodeData,
            WorkflowNodeKind,
        },
        planner::{NodeExecutionSnapshot, NodeExecutionStatus, RunSnapshot, plan_ready_nodes},
    };

    fn node(id: &str, kind: WorkflowNodeKind) -> WorkflowNode {
        WorkflowNode {
            id: id.to_string(),
            kind,
            data: WorkflowNodeData::default(),
            position: None,
        }
    }

    fn edge(id: &str, source: &str, target: &str) -> WorkflowEdge {
        WorkflowEdge {
            id: id.to_string(),
            source: source.to_string(),
            source_handle: Some("output-right".to_string()),
            target: target.to_string(),
            target_handle: Some("input-left".to_string()),
            kind: WorkflowEdgeKind::Default,
        }
    }

    fn graph(nodes: Vec<WorkflowNode>, edges: Vec<WorkflowEdge>) -> WorkflowGraph {
        WorkflowGraph {
            version: 2,
            nodes,
            edges,
            canvas: None,
        }
    }

    fn snapshot(nodes: &[(&str, NodeExecutionStatus)]) -> RunSnapshot {
        RunSnapshot {
            run_id: "run-1".to_string(),
            nodes: nodes
                .iter()
                .map(|(node_id, status)| NodeExecutionSnapshot {
                    node_id: (*node_id).to_string(),
                    iteration: 0,
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
    fn fan_in_is_ready_after_any_upstream_succeeds() {
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

        let ready_after_one = plan_ready_nodes(
            &graph,
            &snapshot(&[
                ("start", NodeExecutionStatus::Succeeded),
                ("a", NodeExecutionStatus::Succeeded),
            ]),
        );
        assert_eq!(ready_after_one.ready_nodes[0].node_id, "b");
        assert_eq!(ready_after_one.ready_nodes[1].node_id, "join");

        let ready = plan_ready_nodes(
            &graph,
            &snapshot(&[
                ("start", NodeExecutionStatus::Succeeded),
                ("a", NodeExecutionStatus::Succeeded),
                ("b", NodeExecutionStatus::Succeeded),
            ]),
        );
        assert_eq!(
            ready
                .ready_nodes
                .iter()
                .map(|node| node.node_id.as_str())
                .collect::<Vec<_>>(),
            vec!["join"]
        );
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
    fn fan_out_keeps_multiple_ready_agent_nodes() {
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

        assert_eq!(
            plan.ready_nodes
                .iter()
                .map(|node| node.node_id.as_str())
                .collect::<Vec<_>>(),
            vec!["agent-a", "agent-b"]
        );
        assert!(plan.warnings.is_empty());
    }

    #[test]
    fn fan_in_can_ready_later_iterations_for_same_node() {
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

        let plan = plan_ready_nodes(
            &graph,
            &RunSnapshot {
                run_id: "run-1".to_string(),
                nodes: vec![
                    NodeExecutionSnapshot {
                        node_id: "start".to_string(),
                        iteration: 0,
                        status: NodeExecutionStatus::Succeeded,
                        output_text: None,
                        error_text: None,
                    },
                    NodeExecutionSnapshot {
                        node_id: "a".to_string(),
                        iteration: 0,
                        status: NodeExecutionStatus::Succeeded,
                        output_text: None,
                        error_text: None,
                    },
                    NodeExecutionSnapshot {
                        node_id: "b".to_string(),
                        iteration: 0,
                        status: NodeExecutionStatus::Succeeded,
                        output_text: None,
                        error_text: None,
                    },
                    NodeExecutionSnapshot {
                        node_id: "join".to_string(),
                        iteration: 0,
                        status: NodeExecutionStatus::Succeeded,
                        output_text: None,
                        error_text: None,
                    },
                    NodeExecutionSnapshot {
                        node_id: "join".to_string(),
                        iteration: 1,
                        status: NodeExecutionStatus::Pending,
                        output_text: None,
                        error_text: None,
                    },
                ],
            },
        );

        assert!(
            plan.ready_nodes
                .iter()
                .any(|node| { node.node_id == "join" && node.iteration == 1 })
        );
    }
}
