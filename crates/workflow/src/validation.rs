use std::{
    collections::{HashMap, HashSet, VecDeque},
    error::Error,
    fmt,
};

use crate::graph::{WorkflowGraph, WorkflowNodeKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedGraph {
    pub version: u32,
    pub start_node_id: String,
    pub end_node_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidationError {
    message: String,
}

impl ValidationError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for ValidationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl Error for ValidationError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VisitState {
    Visiting,
    Visited,
}

pub fn validate_graph(graph: &WorkflowGraph) -> Result<ValidatedGraph, ValidationError> {
    if graph.version != 1 && graph.version != 2 {
        return Err(ValidationError::new(format!(
            "unsupported workflow graph version {}",
            graph.version
        )));
    }

    let mut node_ids = HashSet::new();
    for node in &graph.nodes {
        if !node_ids.insert(node.id.as_str()) {
            return Err(ValidationError::new(format!(
                "duplicate node id `{}`",
                node.id
            )));
        }
    }

    let start_nodes: Vec<_> = graph
        .nodes
        .iter()
        .filter(|node| node.kind == WorkflowNodeKind::Start)
        .collect();
    if start_nodes.is_empty() {
        return Err(ValidationError::new("missing start node"));
    }
    if start_nodes.len() > 1 {
        return Err(ValidationError::new(
            "workflow graph must contain exactly one start node",
        ));
    }

    let end_node_ids: Vec<_> = graph
        .nodes
        .iter()
        .filter(|node| node.kind == WorkflowNodeKind::End)
        .map(|node| node.id.clone())
        .collect();
    if end_node_ids.is_empty() {
        return Err(ValidationError::new("missing end node"));
    }

    for edge in &graph.edges {
        if !node_ids.contains(edge.source.as_str()) {
            return Err(ValidationError::new(format!(
                "edge `{}` has missing source node `{}`",
                edge.id, edge.source
            )));
        }
        if !node_ids.contains(edge.target.as_str()) {
            return Err(ValidationError::new(format!(
                "edge `{}` has missing target node `{}`",
                edge.id, edge.target
            )));
        }
    }

    let adjacency = adjacency_map(graph);
    reject_cycles(graph, &adjacency)?;

    let start_node_id = start_nodes[0].id.as_str();
    let reachable = reachable_nodes(start_node_id, &adjacency);
    for node in &graph.nodes {
        if node.kind != WorkflowNodeKind::Start && !reachable.contains(node.id.as_str()) {
            return Err(ValidationError::new(format!(
                "unreachable node `{}`",
                node.id
            )));
        }
    }

    Ok(ValidatedGraph {
        version: graph.version,
        start_node_id: start_node_id.to_string(),
        end_node_ids,
    })
}

fn adjacency_map(graph: &WorkflowGraph) -> HashMap<&str, Vec<&str>> {
    let mut adjacency: HashMap<&str, Vec<&str>> = graph
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), Vec::new()))
        .collect();

    for edge in &graph.edges {
        adjacency
            .entry(edge.source.as_str())
            .or_default()
            .push(edge.target.as_str());
    }

    adjacency
}

fn reject_cycles(
    graph: &WorkflowGraph,
    adjacency: &HashMap<&str, Vec<&str>>,
) -> Result<(), ValidationError> {
    let mut states = HashMap::new();

    for node in &graph.nodes {
        if !states.contains_key(node.id.as_str()) {
            visit_for_cycle(node.id.as_str(), adjacency, &mut states)?;
        }
    }

    Ok(())
}

fn visit_for_cycle<'a>(
    node_id: &'a str,
    adjacency: &HashMap<&'a str, Vec<&'a str>>,
    states: &mut HashMap<&'a str, VisitState>,
) -> Result<(), ValidationError> {
    match states.get(node_id) {
        Some(VisitState::Visiting) => {
            return Err(ValidationError::new(format!(
                "workflow graph contains a cycle at `{node_id}`"
            )));
        }
        Some(VisitState::Visited) => return Ok(()),
        None => {}
    }

    states.insert(node_id, VisitState::Visiting);

    if let Some(targets) = adjacency.get(node_id) {
        for target in targets {
            visit_for_cycle(target, adjacency, states)?;
        }
    }

    states.insert(node_id, VisitState::Visited);
    Ok(())
}

fn reachable_nodes<'a>(
    start_node_id: &'a str,
    adjacency: &HashMap<&'a str, Vec<&'a str>>,
) -> HashSet<&'a str> {
    let mut reachable = HashSet::new();
    let mut queue = VecDeque::from([start_node_id]);

    while let Some(node_id) = queue.pop_front() {
        if !reachable.insert(node_id) {
            continue;
        }

        if let Some(targets) = adjacency.get(node_id) {
            queue.extend(targets.iter().copied());
        }
    }

    reachable
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::{
        WorkflowEdge, WorkflowEdgeKind, WorkflowGraph, WorkflowNode, WorkflowNodeData,
        WorkflowNodeKind,
    };

    fn node(id: &str, kind: WorkflowNodeKind) -> WorkflowNode {
        WorkflowNode {
            id: id.to_string(),
            kind,
            data: WorkflowNodeData {
                display_name: Some(id.to_string()),
                ..WorkflowNodeData::default()
            },
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

    #[test]
    fn accepts_graph_with_single_start_to_end_path() {
        let graph = graph(
            vec![
                node("start", WorkflowNodeKind::Start),
                node("end", WorkflowNodeKind::End),
            ],
            vec![edge("e1", "start", "end")],
        );

        validate_graph(&graph).unwrap();
    }

    #[test]
    fn rejects_graph_without_start() {
        let graph = graph(
            vec![
                node("agent", WorkflowNodeKind::Agent),
                node("end", WorkflowNodeKind::End),
            ],
            vec![edge("e1", "agent", "end")],
        );

        let err = validate_graph(&graph).unwrap_err();
        assert!(err.to_string().contains("start"));
    }

    #[test]
    fn rejects_graph_with_multiple_start_nodes() {
        let graph = graph(
            vec![
                node("start-a", WorkflowNodeKind::Start),
                node("start-b", WorkflowNodeKind::Start),
                node("end", WorkflowNodeKind::End),
            ],
            vec![edge("e1", "start-a", "end"), edge("e2", "start-b", "end")],
        );

        let err = validate_graph(&graph).unwrap_err();
        assert!(err.to_string().contains("start"));
    }

    #[test]
    fn rejects_graph_with_cycle() {
        let graph = graph(
            vec![
                node("start", WorkflowNodeKind::Start),
                node("agent", WorkflowNodeKind::Agent),
                node("end", WorkflowNodeKind::End),
            ],
            vec![
                edge("e1", "start", "agent"),
                edge("e2", "agent", "start"),
                edge("e3", "agent", "end"),
            ],
        );

        let err = validate_graph(&graph).unwrap_err();
        assert!(err.to_string().contains("cycle"));
    }

    #[test]
    fn rejects_unreachable_executable_node() {
        let graph = graph(
            vec![
                node("start", WorkflowNodeKind::Start),
                node("agent", WorkflowNodeKind::Agent),
                node("end", WorkflowNodeKind::End),
            ],
            vec![edge("e1", "start", "end")],
        );

        let err = validate_graph(&graph).unwrap_err();
        assert!(err.to_string().contains("unreachable"));
    }

    #[test]
    fn rejects_edge_with_missing_endpoint() {
        let graph = graph(
            vec![
                node("start", WorkflowNodeKind::Start),
                node("end", WorkflowNodeKind::End),
            ],
            vec![edge("e1", "start", "missing")],
        );

        let err = validate_graph(&graph).unwrap_err();
        assert!(err.to_string().contains("missing"));
    }
}
