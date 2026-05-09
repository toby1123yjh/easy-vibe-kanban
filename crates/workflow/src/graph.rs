use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowGraph {
    pub version: u32,
    pub nodes: Vec<WorkflowNode>,
    pub edges: Vec<WorkflowEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowNode {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: WorkflowNodeKind,
    pub data: WorkflowNodeData,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkflowEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    #[serde(rename = "type")]
    pub kind: WorkflowEdgeKind,
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
}
