use std::{collections::HashSet, error::Error, fmt};

use regex::Regex;

use crate::{
    graph::{
        ConditionJoiner, ConditionOperator, WorkflowEdge, WorkflowNode, WorkflowNodeData,
        WorkflowNodeKind,
    },
    transform::{TransformError, apply_transform},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeHandlerStatus {
    Succeeded,
    AwaitingHuman,
    AwaitingArena,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpstreamOutput {
    pub node_id: String,
    pub output_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeHandlerContext {
    pub run_input_text: String,
    pub upstream_outputs: Vec<UpstreamOutput>,
}

impl NodeHandlerContext {
    pub fn from_run_input(run_input_text: impl Into<String>) -> Self {
        Self {
            run_input_text: run_input_text.into(),
            upstream_outputs: Vec::new(),
        }
    }

    pub fn with_upstream_outputs(
        run_input_text: impl Into<String>,
        upstream_outputs: Vec<UpstreamOutput>,
    ) -> Self {
        Self {
            run_input_text: run_input_text.into(),
            upstream_outputs,
        }
    }

    pub fn upstream_text(&self) -> String {
        if self.upstream_outputs.is_empty() {
            return self.run_input_text.clone();
        }

        self.upstream_outputs
            .iter()
            .map(|output| output.output_text.as_str())
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    fn input_named(&self, name: Option<&str>) -> String {
        let Some(name) = name else {
            return self.upstream_text();
        };
        if name == "run_input" {
            return self.run_input_text.clone();
        }

        self.upstream_outputs
            .iter()
            .find(|output| output.node_id == name)
            .map(|output| output.output_text.clone())
            .unwrap_or_else(|| self.upstream_text())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeHandlerOutcome {
    pub status: NodeHandlerStatus,
    pub output_text: Option<String>,
    pub selected_target_node_ids: Vec<String>,
    pub skipped_target_node_ids: Vec<String>,
    pub prompt: Option<String>,
}

impl NodeHandlerOutcome {
    fn succeeded(output_text: impl Into<String>) -> Self {
        Self {
            status: NodeHandlerStatus::Succeeded,
            output_text: Some(output_text.into()),
            selected_target_node_ids: Vec::new(),
            skipped_target_node_ids: Vec::new(),
            prompt: None,
        }
    }

    fn waiting(status: NodeHandlerStatus, prompt: Option<String>) -> Self {
        Self {
            status,
            output_text: None,
            selected_target_node_ids: Vec::new(),
            skipped_target_node_ids: Vec::new(),
            prompt,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HandlerError {
    message: String,
}

impl HandlerError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl From<TransformError> for HandlerError {
    fn from(error: TransformError) -> Self {
        Self::new(error.to_string())
    }
}

impl fmt::Display for HandlerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl Error for HandlerError {}

pub fn handle_pure_node(
    node: &WorkflowNode,
    outgoing_edges: &[WorkflowEdge],
    context: &NodeHandlerContext,
) -> Result<NodeHandlerOutcome, HandlerError> {
    match node.kind {
        WorkflowNodeKind::Start => Ok(handle_start(context)),
        WorkflowNodeKind::End => Ok(handle_end(context)),
        WorkflowNodeKind::Condition => handle_condition(node, outgoing_edges, context),
        WorkflowNodeKind::Transform => handle_transform(node, context),
        WorkflowNodeKind::HumanGate => Ok(handle_human_gate(node)),
        WorkflowNodeKind::Arena => Ok(handle_arena(node)),
        WorkflowNodeKind::Agent => Err(HandlerError::new(
            "agent nodes require an executor port and are not pure handlers",
        )),
    }
}

pub fn handle_start(context: &NodeHandlerContext) -> NodeHandlerOutcome {
    NodeHandlerOutcome::succeeded(context.run_input_text.clone())
}

pub fn handle_end(context: &NodeHandlerContext) -> NodeHandlerOutcome {
    NodeHandlerOutcome::succeeded(context.upstream_text())
}

pub fn handle_condition(
    node: &WorkflowNode,
    outgoing_edges: &[WorkflowEdge],
    context: &NodeHandlerContext,
) -> Result<NodeHandlerOutcome, HandlerError> {
    let matched = evaluate_conditions(&node.data, context)?;
    let selected_branch_name = if matched { "true" } else { "false" };
    let mut selected_target_node_ids =
        branch_targets(&node.data, selected_branch_name, outgoing_edges);
    if selected_target_node_ids.is_empty() {
        selected_target_node_ids = branch_targets(&node.data, "default", outgoing_edges);
    }

    let selected: HashSet<_> = selected_target_node_ids.iter().cloned().collect();
    let skipped_target_node_ids = outgoing_edges
        .iter()
        .map(|edge| edge.target.clone())
        .filter(|target| !selected.contains(target))
        .collect();

    Ok(NodeHandlerOutcome {
        status: NodeHandlerStatus::Succeeded,
        output_text: Some(matched.to_string()),
        selected_target_node_ids,
        skipped_target_node_ids,
        prompt: None,
    })
}

pub fn handle_transform(
    node: &WorkflowNode,
    context: &NodeHandlerContext,
) -> Result<NodeHandlerOutcome, HandlerError> {
    Ok(NodeHandlerOutcome::succeeded(apply_transform(
        &node.data,
        &context.upstream_text(),
    )?))
}

pub fn handle_human_gate(node: &WorkflowNode) -> NodeHandlerOutcome {
    NodeHandlerOutcome::waiting(
        NodeHandlerStatus::AwaitingHuman,
        node.data.prompt_to_human.clone(),
    )
}

pub fn handle_arena(node: &WorkflowNode) -> NodeHandlerOutcome {
    NodeHandlerOutcome::waiting(
        NodeHandlerStatus::AwaitingArena,
        node.data.prompt_template.clone(),
    )
}

fn evaluate_conditions(
    data: &WorkflowNodeData,
    context: &NodeHandlerContext,
) -> Result<bool, HandlerError> {
    let Some(rules) = data.conditions.as_ref() else {
        return Ok(false);
    };
    if rules.is_empty() {
        return Ok(false);
    }

    let mut results = Vec::with_capacity(rules.len());
    for rule in rules {
        let input = context.input_named(rule.input.as_deref());
        let value = rule.value.as_deref().unwrap_or_default();
        let result = match rule
            .operator
            .as_ref()
            .unwrap_or(&ConditionOperator::Contains)
        {
            ConditionOperator::Contains => input.contains(value),
            ConditionOperator::Equals => input == value,
            ConditionOperator::NotEquals => input != value,
            ConditionOperator::Regex => Regex::new(value)
                .map_err(|err| HandlerError::new(format!("invalid condition regex: {err}")))?
                .is_match(&input),
        };
        results.push(result);
    }

    Ok(
        match data.joiner.as_ref().unwrap_or(&ConditionJoiner::And) {
            ConditionJoiner::And => results.into_iter().all(|result| result),
            ConditionJoiner::Or => results.into_iter().any(|result| result),
        },
    )
}

fn branch_targets(
    data: &WorkflowNodeData,
    branch_name: &str,
    outgoing_edges: &[WorkflowEdge],
) -> Vec<String> {
    let branch_targets = data
        .branches
        .as_ref()
        .into_iter()
        .flatten()
        .filter(|branch| branch.name.as_deref() == Some(branch_name))
        .filter_map(|branch| branch.target_node_id.clone())
        .collect::<Vec<_>>();
    if !branch_targets.is_empty() {
        return branch_targets;
    }

    if branch_name == "default" {
        return outgoing_edges
            .iter()
            .map(|edge| edge.target.clone())
            .collect();
    }

    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph::{
        ConditionBranch, ConditionRule, HumanGateAction, TransformMode, WorkflowEdgeKind,
    };

    fn node(id: &str, kind: WorkflowNodeKind, data: WorkflowNodeData) -> WorkflowNode {
        WorkflowNode {
            id: id.to_string(),
            kind,
            data,
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
            data: None,
        }
    }

    fn upstream(node_id: &str, output_text: &str) -> UpstreamOutput {
        UpstreamOutput {
            node_id: node_id.to_string(),
            output_text: output_text.to_string(),
        }
    }

    #[test]
    fn start_outputs_run_input_text() {
        let context = NodeHandlerContext::from_run_input("implement issue");

        let outcome = handle_start(&context);

        assert_eq!(outcome.status, NodeHandlerStatus::Succeeded);
        assert_eq!(outcome.output_text.as_deref(), Some("implement issue"));
    }

    #[test]
    fn end_combines_upstream_outputs() {
        let context = NodeHandlerContext::with_upstream_outputs(
            "run input",
            vec![upstream("a", "first"), upstream("b", "second")],
        );

        let outcome = handle_end(&context);

        assert_eq!(outcome.output_text.as_deref(), Some("first\n\nsecond"));
    }

    #[test]
    fn condition_routes_true_false_and_default_branches() {
        let condition = node(
            "condition",
            WorkflowNodeKind::Condition,
            WorkflowNodeData {
                conditions: Some(vec![ConditionRule {
                    input: Some("run_input".to_string()),
                    operator: Some(ConditionOperator::Contains),
                    value: Some("LGTM".to_string()),
                    ..ConditionRule::default()
                }]),
                branches: Some(vec![
                    ConditionBranch {
                        name: Some("true".to_string()),
                        target_node_id: Some("yes".to_string()),
                        ..ConditionBranch::default()
                    },
                    ConditionBranch {
                        name: Some("false".to_string()),
                        target_node_id: Some("no".to_string()),
                        ..ConditionBranch::default()
                    },
                    ConditionBranch {
                        name: Some("default".to_string()),
                        target_node_id: Some("fallback".to_string()),
                        ..ConditionBranch::default()
                    },
                ]),
                ..WorkflowNodeData::default()
            },
        );
        let outgoing = vec![
            edge("e1", "condition", "yes"),
            edge("e2", "condition", "no"),
            edge("e3", "condition", "fallback"),
        ];

        let yes = handle_condition(
            &condition,
            &outgoing,
            &NodeHandlerContext::from_run_input("LGTM ship it"),
        )
        .unwrap();
        assert_eq!(yes.selected_target_node_ids, vec!["yes"]);
        assert_eq!(yes.skipped_target_node_ids, vec!["no", "fallback"]);

        let no = handle_condition(
            &condition,
            &outgoing,
            &NodeHandlerContext::from_run_input("needs work"),
        )
        .unwrap();
        assert_eq!(no.selected_target_node_ids, vec!["no"]);

        let default_only = node(
            "condition",
            WorkflowNodeKind::Condition,
            WorkflowNodeData {
                branches: Some(vec![ConditionBranch {
                    name: Some("default".to_string()),
                    target_node_id: Some("fallback".to_string()),
                    ..ConditionBranch::default()
                }]),
                ..WorkflowNodeData::default()
            },
        );
        let default = handle_condition(
            &default_only,
            &outgoing,
            &NodeHandlerContext::from_run_input("anything"),
        )
        .unwrap();
        assert_eq!(default.selected_target_node_ids, vec!["fallback"]);
    }

    #[test]
    fn transform_template_wraps_upstream_text() {
        let transform = node(
            "transform",
            WorkflowNodeKind::Transform,
            WorkflowNodeData {
                mode: Some(TransformMode::Template),
                template: Some("Summary: {{input}}".to_string()),
                ..WorkflowNodeData::default()
            },
        );
        let context = NodeHandlerContext::with_upstream_outputs(
            "run input",
            vec![upstream("agent", "agent output")],
        );

        let outcome = handle_transform(&transform, &context).unwrap();

        assert_eq!(
            outcome.output_text.as_deref(),
            Some("Summary: agent output")
        );
    }

    #[test]
    fn transform_regex_extract_returns_first_capture() {
        let transform = node(
            "transform",
            WorkflowNodeKind::Transform,
            WorkflowNodeData {
                mode: Some(TransformMode::RegexExtract),
                regex: Some("PR-(\\d+)".to_string()),
                ..WorkflowNodeData::default()
            },
        );
        let context = NodeHandlerContext::with_upstream_outputs(
            "run input",
            vec![upstream("agent", "created PR-123")],
        );

        let outcome = handle_transform(&transform, &context).unwrap();

        assert_eq!(outcome.output_text.as_deref(), Some("123"));
    }

    #[test]
    fn transform_truncate_respects_character_limit() {
        let transform = node(
            "transform",
            WorkflowNodeKind::Transform,
            WorkflowNodeData {
                mode: Some(TransformMode::Truncate),
                max_chars: Some(3),
                ..WorkflowNodeData::default()
            },
        );
        let context =
            NodeHandlerContext::with_upstream_outputs("run input", vec![upstream("agent", "åbcd")]);

        let outcome = handle_transform(&transform, &context).unwrap();

        assert_eq!(outcome.output_text.as_deref(), Some("åbc"));
    }

    #[test]
    fn human_gate_returns_paused_state() {
        let gate = node(
            "gate",
            WorkflowNodeKind::HumanGate,
            WorkflowNodeData {
                prompt_to_human: Some("Approve?".to_string()),
                required_action: Some(HumanGateAction::ApproveOrReject),
                ..WorkflowNodeData::default()
            },
        );

        let outcome = handle_human_gate(&gate);

        assert_eq!(outcome.status, NodeHandlerStatus::AwaitingHuman);
        assert_eq!(outcome.prompt.as_deref(), Some("Approve?"));
    }

    #[test]
    fn arena_returns_awaiting_arena_state() {
        let arena = node(
            "arena",
            WorkflowNodeKind::Arena,
            WorkflowNodeData {
                prompt_template: Some("Build candidates".to_string()),
                ..WorkflowNodeData::default()
            },
        );

        let outcome = handle_arena(&arena);

        assert_eq!(outcome.status, NodeHandlerStatus::AwaitingArena);
        assert_eq!(outcome.prompt.as_deref(), Some("Build candidates"));
    }
}
