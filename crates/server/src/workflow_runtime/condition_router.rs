use std::{borrow::Cow, collections::HashSet, error::Error, fmt};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use workflow::{
    WorkflowGraph,
    graph::{ConditionRoutingMode, WorkflowEdge, WorkflowNode, WorkflowNodeKind},
};

use crate::workflow_runtime::envelope::{
    WorkflowAgentEnvelope, WorkflowEnvelopeUpstream, render_workflow_agent_envelope,
};

const DECISION_START_TAG: &str = "<workflow_router_decision>";
const DECISION_END_TAG: &str = "</workflow_router_decision>";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouterUpstreamNode {
    pub node_id: String,
    pub node_type: String,
    pub status: String,
    pub output_text: Option<String>,
    pub error_text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConditionRouterCompletion {
    pub output_text: String,
    pub selected_target_node_ids: Vec<String>,
    pub skipped_target_node_ids: Vec<String>,
    pub pause_prompt: Option<String>,
}

impl ConditionRouterCompletion {
    pub fn auto_route(
        output_text: String,
        selected_target_node_ids: Vec<String>,
        skipped_target_node_ids: Vec<String>,
    ) -> Self {
        Self {
            output_text,
            selected_target_node_ids,
            skipped_target_node_ids,
            pause_prompt: None,
        }
    }

    pub fn pause(output_text: String, pause_prompt: impl Into<String>) -> Self {
        Self {
            output_text,
            selected_target_node_ids: Vec::new(),
            skipped_target_node_ids: Vec::new(),
            pause_prompt: Some(pause_prompt.into()),
        }
    }

    pub fn should_pause(&self) -> bool {
        self.pause_prompt.is_some()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManualConditionRoute {
    pub output_text: String,
    pub selected_target_node_ids: Vec<String>,
    pub skipped_target_node_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConditionRouterError {
    message: String,
}

impl ConditionRouterError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for ConditionRouterError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl Error for ConditionRouterError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RouterDecisionStatus {
    Selected,
    NeedsUser,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum RouterDecisionConfidence {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RouterDecision {
    schema_version: u32,
    status: RouterDecisionStatus,
    #[serde(default)]
    selected_target_node_ids: Vec<String>,
    #[serde(default)]
    skipped_target_node_ids: Vec<String>,
    confidence: Option<RouterDecisionConfidence>,
    reason: Option<String>,
    question: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ValidatedSelection {
    selected_target_node_ids: Vec<String>,
    skipped_target_node_ids: Vec<String>,
}

pub fn build_router_prompt(
    run_id: &str,
    graph: &WorkflowGraph,
    condition_node: &WorkflowNode,
    run_input_text: &str,
    upstream_nodes: &[RouterUpstreamNode],
    worktree_summary: Option<&str>,
) -> Result<String, ConditionRouterError> {
    if condition_node.kind != WorkflowNodeKind::Condition {
        return Err(ConditionRouterError::new(format!(
            "Workflow node `{}` is not a condition",
            condition_node.id
        )));
    }

    let candidates = condition_candidates(graph, condition_node);
    if candidates.is_empty() {
        return Err(ConditionRouterError::new(format!(
            "Condition node `{}` has no outgoing candidates",
            condition_node.id
        )));
    }

    let node_task = render_router_node_task(run_id, condition_node, &candidates, worktree_summary);
    let upstream_handoff = upstream_nodes
        .iter()
        .map(router_upstream_handoff)
        .collect::<Vec<_>>();
    let handoff_contract = "- Work in the shared workflow workspace/worktree only for read-only inspection.\n\
- Do not modify files and do not perform implementation work; this Condition node only decides routing.\n\
- Treat direct upstream handoff as the prior workflow context for branch selection.\n\
- Choose only connected downstream candidate node ids listed in `Node Task`.\n\
- If no branch clearly matches or required information is missing, return `needs_user` with a specific question instead of guessing.\n\
- Finish with exactly one `workflow_router_decision` block; ordinary prose alone will pause the workflow.";
    let node_name = node_label(condition_node);

    Ok(render_workflow_agent_envelope(WorkflowAgentEnvelope {
        node_type_label: "Condition router",
        node_name: &node_name,
        node_id: &condition_node.id,
        workflow_input: run_input_text,
        upstream_handoff: &upstream_handoff,
        node_task: &node_task,
        handoff_contract,
    }))
}

fn render_router_node_task(
    run_id: &str,
    condition_node: &WorkflowNode,
    candidates: &[ConditionCandidate],
    worktree_summary: Option<&str>,
) -> String {
    let routing_mode = condition_routing_mode(condition_node);
    let mut task = String::new();
    task.push_str("You are the router for one workflow Condition node.\n");
    task.push_str("Do not modify files. You may inspect the repository read-only if needed.\n");
    task.push_str("Choose only from the connected downstream candidate node ids listed below.\n");
    task.push_str(
        "If no branch clearly matches, return status needs_user and ask a concise question.\n\n",
    );
    task.push_str("Route in this order:\n");
    task.push_str("1. Understand what the direct upstream node(s) completed, including any persisted file changes or generated files shown in the worktree evidence.\n");
    task.push_str("2. Analyze each downstream branch condition and the target label to determine what evidence would justify choosing that branch.\n");
    task.push_str("3. Compare upstream completion evidence against each branch condition, then select only branches that clearly match.\n");
    task.push_str("Do not choose a branch only because its label sounds plausible; require evidence from upstream handoff, file changes, generated files, or read-only inspection.\n\n");
    task.push_str(&format!("Workflow run id: {run_id}\n"));
    task.push_str(&format!(
        "Routing mode: {}\n\n",
        match routing_mode {
            ConditionRoutingMode::Single => "single",
            ConditionRoutingMode::Multi => "multi",
        }
    ));
    task.push_str("Candidate downstream branches:\n");
    for candidate in candidates {
        task.push_str(&format!(
            "- node_id: {}\n  label: {}\n  condition: {}\n",
            candidate.target_node_id, candidate.target_label, candidate.condition
        ));
    }
    task.push_str("\nWorktree evidence before routing:\n");
    task.push_str(worktree_summary.unwrap_or("Not captured."));
    task.push_str("\n\nReturn exactly one decision block and no second block:\n");
    task.push_str(DECISION_START_TAG);
    task.push_str(
        r#"
{
  "schema_version": 1,
  "status": "selected",
  "selected_target_node_ids": ["target-node-id"],
  "skipped_target_node_ids": ["other-target-node-id"],
  "confidence": "high",
  "reason": "Why the selected branch matches.",
  "question": null
}
"#,
    );
    task.push_str(DECISION_END_TAG);
    task.push_str("\n\nFor uncertainty use status needs_user, confidence low, no selected targets, and a question.");

    task
}

fn router_upstream_handoff(upstream: &RouterUpstreamNode) -> WorkflowEnvelopeUpstream<'_> {
    let mut body = String::new();
    body.push_str(&format!(
        "node_id: {}\nnode_type: {}\nstatus: {}",
        upstream.node_id, upstream.node_type, upstream.status
    ));
    if let Some(output_text) = upstream.output_text.as_deref() {
        body.push_str("\noutput:\n");
        body.push_str(&indent_block(output_text, "  "));
    }
    if let Some(error_text) = upstream.error_text.as_deref() {
        body.push_str("\nerror:\n");
        body.push_str(&indent_block(error_text, "  "));
    }

    WorkflowEnvelopeUpstream {
        heading: Cow::Owned(format!(
            "{} [{}] status={}",
            upstream.node_id, upstream.node_type, upstream.status
        )),
        body: Cow::Owned(body),
    }
}

pub fn evaluate_router_output(
    raw_output: &str,
    graph: &WorkflowGraph,
    condition_node: &WorkflowNode,
    mutation_warning: Option<String>,
) -> ConditionRouterCompletion {
    match parse_router_decision(raw_output).and_then(|decision| {
        validate_router_decision(graph, condition_node, decision, mutation_warning.as_deref())
    }) {
        Ok((decision, selection)) => {
            let output_text = router_output_payload(
                "router",
                "selected",
                Some(&decision),
                raw_output,
                &selection.selected_target_node_ids,
                &selection.skipped_target_node_ids,
                "auto_route",
                None,
                mutation_warning.as_deref(),
                false,
            );
            ConditionRouterCompletion::auto_route(
                output_text,
                selection.selected_target_node_ids,
                selection.skipped_target_node_ids,
            )
        }
        Err(err) => {
            let parsed = parse_router_decision(raw_output).ok();
            let err_message = err.to_string();
            let pause_prompt = parsed
                .as_ref()
                .and_then(|decision| decision.question.as_deref())
                .filter(|question| !question.trim().is_empty())
                .unwrap_or(err_message.as_str())
                .to_string();
            let output_text = router_output_payload(
                "router",
                "awaiting_human",
                parsed.as_ref(),
                raw_output,
                &[],
                &[],
                "pause",
                Some(&err_message),
                mutation_warning.as_deref(),
                false,
            );
            ConditionRouterCompletion::pause(output_text, pause_prompt)
        }
    }
}

pub fn build_manual_route(
    graph: &WorkflowGraph,
    condition_node: &WorkflowNode,
    selected_target_node_ids: &[String],
    reason: Option<&str>,
    overrode_router_mutation_warning: bool,
) -> Result<ManualConditionRoute, ConditionRouterError> {
    let selection = validate_target_selection(graph, condition_node, selected_target_node_ids)?;
    let output_text = router_output_payload(
        "user",
        "selected",
        None,
        "",
        &selection.selected_target_node_ids,
        &selection.skipped_target_node_ids,
        "manual_route",
        reason,
        None,
        overrode_router_mutation_warning,
    );

    Ok(ManualConditionRoute {
        output_text,
        selected_target_node_ids: selection.selected_target_node_ids,
        skipped_target_node_ids: selection.skipped_target_node_ids,
    })
}

pub fn output_has_router_mutation_warning(output_text: Option<&str>) -> bool {
    output_text
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .and_then(|value| {
            value
                .get("validation")
                .and_then(|validation| validation.get("mutation_warning"))
                .cloned()
        })
        .is_some_and(|warning| !warning.is_null())
}

fn parse_router_decision(raw_output: &str) -> Result<RouterDecision, ConditionRouterError> {
    let mut matches = Vec::new();
    let mut search_from = 0;
    while let Some(start_offset) = raw_output[search_from..].find(DECISION_START_TAG) {
        let start = search_from + start_offset + DECISION_START_TAG.len();
        let Some(end_offset) = raw_output[start..].find(DECISION_END_TAG) else {
            return Err(ConditionRouterError::new(
                "Router decision block is missing the closing tag",
            ));
        };
        let end = start + end_offset;
        matches.push(raw_output[start..end].trim().to_string());
        search_from = end + DECISION_END_TAG.len();
    }

    match matches.len() {
        0 => Err(ConditionRouterError::new(
            "Router output did not contain a workflow_router_decision block",
        )),
        1 => {
            let decision: RouterDecision = serde_json::from_str(&matches[0]).map_err(|err| {
                ConditionRouterError::new(format!("Router decision JSON is invalid: {err}"))
            })?;
            if decision.schema_version != 1 {
                return Err(ConditionRouterError::new(format!(
                    "Unsupported router decision schema_version `{}`",
                    decision.schema_version
                )));
            }
            Ok(decision)
        }
        _ => Err(ConditionRouterError::new(
            "Router output contained multiple workflow_router_decision blocks",
        )),
    }
}

fn validate_router_decision(
    graph: &WorkflowGraph,
    condition_node: &WorkflowNode,
    decision: RouterDecision,
    mutation_warning: Option<&str>,
) -> Result<(RouterDecision, ValidatedSelection), ConditionRouterError> {
    if let Some(warning) = mutation_warning.filter(|warning| !warning.trim().is_empty()) {
        return Err(ConditionRouterError::new(format!(
            "Router modified the worktree; review before continuing: {warning}"
        )));
    }

    if decision.status == RouterDecisionStatus::NeedsUser {
        return Err(ConditionRouterError::new(
            decision
                .question
                .as_deref()
                .filter(|question| !question.trim().is_empty())
                .unwrap_or("Router requested user input"),
        ));
    }

    if decision.confidence != Some(RouterDecisionConfidence::High) {
        return Err(ConditionRouterError::new(
            "Router decision confidence is not high",
        ));
    }

    let selection =
        validate_target_selection(graph, condition_node, &decision.selected_target_node_ids)?;
    validate_skipped_targets(
        graph,
        condition_node,
        &decision.skipped_target_node_ids,
        &selection.selected_target_node_ids,
    )?;
    Ok((decision, selection))
}

fn validate_target_selection(
    graph: &WorkflowGraph,
    condition_node: &WorkflowNode,
    selected_target_node_ids: &[String],
) -> Result<ValidatedSelection, ConditionRouterError> {
    if condition_node.kind != WorkflowNodeKind::Condition {
        return Err(ConditionRouterError::new(format!(
            "Workflow node `{}` is not a condition",
            condition_node.id
        )));
    }

    let outgoing_target_ids = condition_outgoing_target_ids(graph, condition_node);
    if outgoing_target_ids.is_empty() {
        return Err(ConditionRouterError::new(format!(
            "Condition node `{}` has no outgoing targets",
            condition_node.id
        )));
    }
    if selected_target_node_ids.is_empty() {
        return Err(ConditionRouterError::new(
            "Condition routing selection cannot be empty",
        ));
    }

    let mut seen = HashSet::new();
    for target_id in selected_target_node_ids {
        if !seen.insert(target_id.as_str()) {
            return Err(ConditionRouterError::new(format!(
                "Condition routing selected duplicate target `{target_id}`"
            )));
        }
        if !outgoing_target_ids.contains(target_id) {
            return Err(ConditionRouterError::new(format!(
                "Condition routing selected non-outgoing target `{target_id}`"
            )));
        }
    }

    match condition_routing_mode(condition_node) {
        ConditionRoutingMode::Single if selected_target_node_ids.len() != 1 => {
            return Err(ConditionRouterError::new(
                "Condition is in single routing mode but selected multiple targets",
            ));
        }
        ConditionRoutingMode::Single | ConditionRoutingMode::Multi => {}
    }

    let selected = selected_target_node_ids.to_vec();
    let skipped = outgoing_target_ids
        .into_iter()
        .filter(|target_id| !selected.contains(target_id))
        .collect();

    Ok(ValidatedSelection {
        selected_target_node_ids: selected,
        skipped_target_node_ids: skipped,
    })
}

fn validate_skipped_targets(
    graph: &WorkflowGraph,
    condition_node: &WorkflowNode,
    skipped_target_node_ids: &[String],
    selected_target_node_ids: &[String],
) -> Result<(), ConditionRouterError> {
    let outgoing_target_ids = condition_outgoing_target_ids(graph, condition_node);
    for target_id in skipped_target_node_ids {
        if !outgoing_target_ids.contains(target_id) {
            return Err(ConditionRouterError::new(format!(
                "Router skipped non-outgoing target `{target_id}`"
            )));
        }
        if selected_target_node_ids.contains(target_id) {
            return Err(ConditionRouterError::new(format!(
                "Router both selected and skipped target `{target_id}`"
            )));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ConditionCandidate {
    target_node_id: String,
    target_label: String,
    condition: String,
}

fn condition_candidates(
    graph: &WorkflowGraph,
    condition_node: &WorkflowNode,
) -> Vec<ConditionCandidate> {
    condition_outgoing_edges(graph, condition_node)
        .into_iter()
        .map(|edge| {
            let target_node = graph.nodes.iter().find(|node| node.id == edge.target);
            let branch = condition_node.data.branches.as_ref().and_then(|branches| {
                branches
                    .iter()
                    .find(|branch| branch.target_node_id.as_deref() == Some(edge.target.as_str()))
            });
            ConditionCandidate {
                target_node_id: edge.target.clone(),
                target_label: target_node
                    .map(node_label)
                    .unwrap_or_else(|| edge.target.clone()),
                condition: branch
                    .and_then(|branch| branch.condition.clone())
                    .unwrap_or_default(),
            }
        })
        .collect()
}

fn condition_outgoing_target_ids(
    graph: &WorkflowGraph,
    condition_node: &WorkflowNode,
) -> Vec<String> {
    condition_outgoing_edges(graph, condition_node)
        .into_iter()
        .map(|edge| edge.target.clone())
        .collect()
}

fn condition_outgoing_edges<'a>(
    graph: &'a WorkflowGraph,
    condition_node: &WorkflowNode,
) -> Vec<&'a WorkflowEdge> {
    graph
        .edges
        .iter()
        .filter(|edge| edge.source == condition_node.id)
        .collect()
}

fn condition_routing_mode(condition_node: &WorkflowNode) -> ConditionRoutingMode {
    condition_node
        .data
        .routing_mode
        .clone()
        .unwrap_or(ConditionRoutingMode::Single)
}

fn node_label(node: &WorkflowNode) -> String {
    node.data
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(&node.id)
        .to_string()
}

fn indent_block(value: &str, prefix: &str) -> String {
    value
        .lines()
        .map(|line| format!("{prefix}{line}"))
        .collect::<Vec<_>>()
        .join("\n")
}

#[allow(clippy::too_many_arguments)]
fn router_output_payload(
    source: &str,
    status: &str,
    decision: Option<&RouterDecision>,
    raw_output: &str,
    selected_target_node_ids: &[String],
    skipped_target_node_ids: &[String],
    validation_result: &str,
    validation_reason: Option<&str>,
    mutation_warning: Option<&str>,
    overrode_router_mutation_warning: bool,
) -> String {
    serde_json::to_string(&json!({
        "type": "condition_router_decision",
        "source": source,
        "status": status,
        "schema_version": 1,
        "decision": decision,
        "raw_output": raw_output,
        "selected_target_node_ids": selected_target_node_ids,
        "skipped_target_node_ids": skipped_target_node_ids,
        "validation": {
            "result": validation_result,
            "reason": validation_reason,
            "mutation_warning": mutation_warning,
            "overrode_router_mutation_warning": overrode_router_mutation_warning
        }
    }))
    .unwrap_or_else(|_| {
        "{\"type\":\"condition_router_decision\",\"status\":\"serialization_failed\"}".to_string()
    })
}

#[cfg(test)]
mod tests {
    use workflow::graph::{
        ConditionBranch, WorkflowEdge, WorkflowEdgeKind, WorkflowNodeData, WorkflowNodePosition,
    };

    use super::*;

    fn node(id: &str, kind: WorkflowNodeKind, display_name: &str) -> WorkflowNode {
        WorkflowNode {
            id: id.to_string(),
            kind,
            data: WorkflowNodeData {
                display_name: Some(display_name.to_string()),
                ..WorkflowNodeData::default()
            },
            position: Some(WorkflowNodePosition { x: 0.0, y: 0.0 }),
        }
    }

    fn condition(id: &str, mode: ConditionRoutingMode) -> WorkflowNode {
        WorkflowNode {
            id: id.to_string(),
            kind: WorkflowNodeKind::Condition,
            data: WorkflowNodeData {
                display_name: Some("Route work".to_string()),
                routing_mode: Some(mode),
                branches: Some(vec![
                    ConditionBranch {
                        target_node_id: Some("ui".to_string()),
                        condition: Some("Upstream changed UI".to_string()),
                        ..ConditionBranch::default()
                    },
                    ConditionBranch {
                        target_node_id: Some("api".to_string()),
                        condition: Some("Upstream changed API".to_string()),
                        ..ConditionBranch::default()
                    },
                ]),
                ..WorkflowNodeData::default()
            },
            position: Some(WorkflowNodePosition { x: 0.0, y: 0.0 }),
        }
    }

    fn edge(source: &str, target: &str) -> WorkflowEdge {
        WorkflowEdge {
            id: format!("{source}-{target}"),
            source: source.to_string(),
            source_handle: None,
            target: target.to_string(),
            target_handle: None,
            kind: WorkflowEdgeKind::ConditionBranch,
            data: None,
        }
    }

    fn graph(mode: ConditionRoutingMode) -> (WorkflowGraph, WorkflowNode) {
        let condition = condition("condition", mode);
        (
            WorkflowGraph {
                version: 2,
                nodes: vec![
                    node("start", WorkflowNodeKind::Start, "Start"),
                    condition.clone(),
                    node("ui", WorkflowNodeKind::Agent, "UI Agent"),
                    node("api", WorkflowNodeKind::Agent, "API Agent"),
                ],
                edges: vec![
                    edge("start", "condition"),
                    edge("condition", "ui"),
                    edge("condition", "api"),
                ],
                router_executor_config: None,
                canvas: None,
            },
            condition,
        )
    }

    fn decision_json(selected: &[&str], confidence: &str) -> String {
        format!(
            r#"{DECISION_START_TAG}
{{
  "schema_version": 1,
  "status": "selected",
  "selected_target_node_ids": [{}],
  "skipped_target_node_ids": [],
  "confidence": "{confidence}",
  "reason": "Matches",
  "question": null
}}
{DECISION_END_TAG}"#,
            selected
                .iter()
                .map(|id| format!(r#""{id}""#))
                .collect::<Vec<_>>()
                .join(", ")
        )
    }

    #[test]
    fn high_confidence_single_target_auto_routes() {
        let (graph, condition) = graph(ConditionRoutingMode::Single);

        let completion =
            evaluate_router_output(&decision_json(&["ui"], "high"), &graph, &condition, None);

        assert!(!completion.should_pause());
        assert_eq!(completion.selected_target_node_ids, vec!["ui"]);
        assert_eq!(completion.skipped_target_node_ids, vec!["api"]);
    }

    #[test]
    fn multi_mode_allows_multiple_targets() {
        let (graph, condition) = graph(ConditionRoutingMode::Multi);

        let completion = evaluate_router_output(
            &decision_json(&["ui", "api"], "high"),
            &graph,
            &condition,
            None,
        );

        assert!(!completion.should_pause());
        assert_eq!(completion.selected_target_node_ids, vec!["ui", "api"]);
        assert!(completion.skipped_target_node_ids.is_empty());
    }

    #[test]
    fn single_mode_multiple_targets_pauses() {
        let (graph, condition) = graph(ConditionRoutingMode::Single);

        let completion = evaluate_router_output(
            &decision_json(&["ui", "api"], "high"),
            &graph,
            &condition,
            None,
        );

        assert!(completion.should_pause());
        assert!(
            completion
                .pause_prompt
                .as_deref()
                .unwrap()
                .contains("single routing mode")
        );
    }

    #[test]
    fn low_confidence_pauses() {
        let (graph, condition) = graph(ConditionRoutingMode::Single);

        let completion =
            evaluate_router_output(&decision_json(&["ui"], "medium"), &graph, &condition, None);

        assert!(completion.should_pause());
        assert!(
            completion
                .pause_prompt
                .as_deref()
                .unwrap()
                .contains("confidence")
        );
    }

    #[test]
    fn empty_or_illegal_router_selection_pauses() {
        let (graph, condition) = graph(ConditionRoutingMode::Single);

        let empty = evaluate_router_output(&decision_json(&[], "high"), &graph, &condition, None);
        assert!(empty.should_pause());
        assert!(
            empty
                .pause_prompt
                .as_deref()
                .unwrap()
                .contains("cannot be empty")
        );

        let illegal = evaluate_router_output(
            &decision_json(&["missing"], "high"),
            &graph,
            &condition,
            None,
        );
        assert!(illegal.should_pause());
        assert!(
            illegal
                .pause_prompt
                .as_deref()
                .unwrap()
                .contains("non-outgoing")
        );
    }

    #[test]
    fn malformed_or_duplicate_blocks_pause() {
        let (graph, condition) = graph(ConditionRoutingMode::Single);
        let output = format!(
            "{}{}",
            decision_json(&["ui"], "high"),
            decision_json(&["api"], "high")
        );

        let completion = evaluate_router_output(&output, &graph, &condition, None);

        assert!(completion.should_pause());
        assert!(
            completion
                .pause_prompt
                .as_deref()
                .unwrap()
                .contains("multiple")
        );
    }

    #[test]
    fn needs_user_uses_router_question_as_prompt() {
        let (graph, condition) = graph(ConditionRoutingMode::Single);
        let output = format!(
            r#"{DECISION_START_TAG}
{{
  "schema_version": 1,
  "status": "needs_user",
  "selected_target_node_ids": [],
  "skipped_target_node_ids": [],
  "confidence": "low",
  "reason": "Ambiguous",
  "question": "Which branch should continue?"
}}
{DECISION_END_TAG}"#
        );

        let completion = evaluate_router_output(&output, &graph, &condition, None);

        assert!(completion.should_pause());
        assert_eq!(
            completion.pause_prompt.as_deref(),
            Some("Which branch should continue?")
        );
    }

    #[test]
    fn mutation_warning_pauses_even_high_confidence_decision() {
        let (graph, condition) = graph(ConditionRoutingMode::Single);

        let completion = evaluate_router_output(
            &decision_json(&["ui"], "high"),
            &graph,
            &condition,
            Some("1 tracked change".to_string()),
        );

        assert!(completion.should_pause());
        assert!(output_has_router_mutation_warning(Some(
            &completion.output_text
        )));
    }

    #[test]
    fn manual_route_rejects_empty_or_illegal_targets() {
        let (graph, condition) = graph(ConditionRoutingMode::Single);

        let empty = build_manual_route(&graph, &condition, &[], None, false).unwrap_err();
        assert!(empty.to_string().contains("cannot be empty"));

        let illegal = build_manual_route(&graph, &condition, &["missing".to_string()], None, false)
            .unwrap_err();
        assert!(illegal.to_string().contains("non-outgoing"));
    }

    #[test]
    fn manual_route_records_mutation_warning_override() {
        let (graph, condition) = graph(ConditionRoutingMode::Single);

        let route = build_manual_route(
            &graph,
            &condition,
            &["ui".to_string()],
            Some("User reviewed router changes"),
            true,
        )
        .unwrap();
        let payload: Value = serde_json::from_str(&route.output_text).unwrap();

        assert_eq!(payload["source"], "user");
        assert_eq!(payload["validation"]["result"], "manual_route");
        assert_eq!(
            payload["validation"]["overrode_router_mutation_warning"],
            true
        );
    }

    #[test]
    fn prompt_lists_upstream_and_candidate_branch_conditions() {
        let (graph, condition) = graph(ConditionRoutingMode::Single);

        let prompt = build_router_prompt(
            "run-1",
            &graph,
            &condition,
            "Implement the issue",
            &[RouterUpstreamNode {
                node_id: "start".to_string(),
                node_type: "start".to_string(),
                status: "succeeded".to_string(),
                output_text: Some("Initial input".to_string()),
                error_text: None,
            }],
            Some("repo: 1 tracked change"),
        )
        .unwrap();

        assert!(prompt.contains("Upstream changed UI"));
        assert!(prompt.contains("Initial input"));
        assert!(prompt.contains("Route in this order"));
        assert!(prompt.contains("persisted file changes or generated files"));
        assert!(prompt.contains("Worktree evidence before routing"));
        assert!(prompt.contains("# Workflow Agent Envelope"));
        assert!(prompt.contains("- Type: Condition router"));
        assert!(prompt.contains("## Direct Upstream Handoff"));
        assert!(prompt.contains("## Node Task"));
        assert!(prompt.contains(DECISION_START_TAG));
    }

    #[test]
    fn prompt_truncates_large_context_blocks() {
        let (graph, condition) = graph(ConditionRoutingMode::Single);
        let large_output =
            "a".repeat(crate::workflow_runtime::envelope::MAX_WORKFLOW_ENVELOPE_HANDOFF_CHARS + 10);

        let prompt = build_router_prompt(
            "run-1",
            &graph,
            &condition,
            "Implement the issue",
            &[RouterUpstreamNode {
                node_id: "start".to_string(),
                node_type: "start".to_string(),
                status: "succeeded".to_string(),
                output_text: Some(large_output),
                error_text: None,
            }],
            None,
        )
        .unwrap();

        assert!(prompt.contains("[truncated to 12000 characters]"));
    }
}
