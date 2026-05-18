use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowGraph {
    pub version: u32,
    pub nodes: Vec<WorkflowNode>,
    pub edges: Vec<WorkflowEdge>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvas: Option<WorkflowCanvasData>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowNode {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: WorkflowNodeKind,
    pub data: WorkflowNodeData,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<WorkflowNodePosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowNodePosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowEdge {
    pub id: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_handle: Option<String>,
    pub target: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_handle: Option<String>,
    #[serde(rename = "type")]
    pub kind: WorkflowEdgeKind,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct WorkflowCanvasData {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<WorkflowCanvasStickyNote>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub groups: Vec<WorkflowCanvasStageGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowCanvasStickyNote {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: WorkflowCanvasObjectKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default)]
    pub content: String,
    pub position: WorkflowNodePosition,
    pub size: WorkflowCanvasObjectSize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<WorkflowCanvasObjectColor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowCanvasStageGroup {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: WorkflowCanvasObjectKind,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub position: WorkflowNodePosition,
    pub size: WorkflowCanvasObjectSize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<WorkflowCanvasObjectColor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowCanvasObjectSize {
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowCanvasObjectKind {
    StickyNote,
    StageGroup,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowCanvasObjectColor {
    Amber,
    Blue,
    Green,
    Neutral,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowNodeKind {
    Start,
    End,
    Agent,
    Condition,
    HumanGate,
    Transform,
    Arena,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowEdgeKind {
    Default,
    ConditionBranch,
    Approval,
    Rejection,
    ArenaWinner,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct WorkflowNodeData {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_template_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executor_config: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_template: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_capture: Option<AgentOutputCapture>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attempts: Option<Vec<ArenaAttemptConfig>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub promote_strategy: Option<ArenaPromoteStrategy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub apply_strategy: Option<ArenaApplyStrategy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conditions: Option<Vec<ConditionRule>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub joiner: Option<ConditionJoiner>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branches: Option<Vec<ConditionBranch>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_to_human: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_action: Option<HumanGateAction>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<TransformMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regex: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_chars: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentOutputCapture {
    LastMessage,
    FullText,
    DiffSummary,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ArenaAttemptConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role_template_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub executor_config: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_template: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ArenaPromoteStrategy {
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ArenaApplyStrategy {
    DiffApply,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ConditionRule {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operator: Option<ConditionOperator>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConditionOperator {
    Contains,
    Equals,
    NotEquals,
    Regex,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConditionJoiner {
    And,
    Or,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ConditionBranch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_node_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum HumanGateAction {
    Approve,
    ApproveOrReject,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TransformMode {
    Template,
    RegexExtract,
    Truncate,
}

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

    #[test]
    fn parses_edges_with_optional_handles() {
        let graph: WorkflowGraph = serde_json::from_value(serde_json::json!({
            "version": 2,
            "nodes": [
                { "id": "start", "type": "start", "data": { "display_name": "Start" } },
                { "id": "agent", "type": "agent", "data": { "display_name": "Agent" } }
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "start",
                    "source_handle": "output",
                    "target": "agent",
                    "target_handle": "input",
                    "type": "default"
                }
            ]
        }))
        .unwrap();

        assert_eq!(graph.edges[0].source_handle.as_deref(), Some("output"));
        assert_eq!(graph.edges[0].target_handle.as_deref(), Some("input"));
    }

    #[test]
    fn parses_legacy_edges_without_handles() {
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

        assert_eq!(graph.edges[0].source_handle, None);
        assert_eq!(graph.edges[0].target_handle, None);
    }

    #[test]
    fn parses_and_serializes_canvas_metadata() {
        let graph: WorkflowGraph = serde_json::from_value(serde_json::json!({
            "version": 2,
            "nodes": [
                { "id": "start", "type": "start", "data": { "display_name": "Start" } },
                { "id": "end", "type": "end", "data": { "display_name": "End" } }
            ],
            "edges": [
                { "id": "e1", "source": "start", "target": "end", "type": "default" }
            ],
            "canvas": {
                "notes": [
                    {
                        "id": "note-1",
                        "type": "sticky_note",
                        "title": "Context",
                        "content": "Read first",
                        "position": { "x": 100.0, "y": 40.0 },
                        "size": { "width": 260.0, "height": 140.0 },
                        "color": "amber"
                    }
                ],
                "groups": [
                    {
                        "id": "stage-1",
                        "type": "stage_group",
                        "title": "Stage 1",
                        "description": "Understand",
                        "position": { "x": 80.0, "y": 120.0 },
                        "size": { "width": 520.0, "height": 220.0 },
                        "color": "neutral"
                    }
                ]
            }
        }))
        .unwrap();

        let canvas = graph.canvas.as_ref().unwrap();
        assert_eq!(canvas.notes[0].kind, WorkflowCanvasObjectKind::StickyNote);
        assert_eq!(canvas.groups[0].kind, WorkflowCanvasObjectKind::StageGroup);

        let value = serde_json::to_value(&graph).unwrap();
        assert_eq!(value["canvas"]["notes"][0]["type"], "sticky_note");
        assert_eq!(value["canvas"]["groups"][0]["type"], "stage_group");
    }
}
