#[cfg(test)]
mod tests {
    use crate::graph::{
        WorkflowEdge, WorkflowEdgeKind, WorkflowGraph, WorkflowNode, WorkflowNodeData,
        WorkflowNodeKind,
    };

    use super::*;

    fn node(id: &str, kind: WorkflowNodeKind) -> WorkflowNode {
        WorkflowNode {
            id: id.to_string(),
            kind,
            data: WorkflowNodeData {
                display_name: Some(id.to_string()),
                ..WorkflowNodeData::default()
            },
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
            vec![
                edge("e1", "start-a", "end"),
                edge("e2", "start-b", "end"),
            ],
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
