#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_minimal_start_end_graph() {
        let graph: WorkflowGraph = serde_json::from_value(serde_json::json!({
            "version": 1,
            "nodes": [
                { "id": "start", "type": "start", "data": { "display_name": "Start" } },
                { "id": "end", "type": "end", "data": { "display_name": "End" } }
            ],
            "edges": [
                { "id": "e1", "source": "start", "target": "end", "type": "default" }
            ]
        }))
        .unwrap();

        assert_eq!(graph.version, 1);
        assert_eq!(graph.nodes.len(), 2);
    }
}
