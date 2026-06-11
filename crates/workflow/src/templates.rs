use serde_json::json;

use crate::graph::{
    AgentOutputCapture, WorkflowEdge, WorkflowEdgeKind, WorkflowGraph, WorkflowNode,
    WorkflowNodeData, WorkflowNodeKind,
};

// Stable system template ids. These ids are persisted by workflow_runs.workflow_id.
const PLAN_PARALLEL_FULLSTACK_REVIEW_FINALIZE_ID: &str = "8f1f2f0c-0e58-4c7c-8dc1-000000000004";
const RESEARCH_MULTI_PERSPECTIVE_SYNTHESIZE_ID: &str = "8f1f2f0c-0e58-4c7c-8dc1-000000000005";

#[derive(Debug, Clone, PartialEq)]
pub struct WorkflowTemplate {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub graph: WorkflowGraph,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoleTemplate {
    pub id: &'static str,
    pub name: &'static str,
    pub description: &'static str,
    pub prompt_template: &'static str,
}

pub fn built_in_templates() -> Vec<WorkflowTemplate> {
    vec![
        plan_parallel_fullstack_review_finalize(),
        research_multi_perspective_synthesize(),
    ]
}

pub fn role_templates() -> Vec<RoleTemplate> {
    vec![
        RoleTemplate {
            id: "architect",
            name: "Architect",
            description: "Plans structure, boundaries, and implementation sequence.",
            prompt_template: "Design the implementation approach for the issue.",
        },
        RoleTemplate {
            id: "researcher",
            name: "Researcher",
            description: "Inspects the codebase and gathers relevant context.",
            prompt_template: "Research the issue and summarize the useful code context.",
        },
        RoleTemplate {
            id: "implementer",
            name: "Implementer",
            description: "Makes focused code changes for the requested task.",
            prompt_template: "Implement the requested change using the provided plan and context.",
        },
        RoleTemplate {
            id: "reviewer",
            name: "Reviewer",
            description: "Reviews changes for correctness, risk, and missing tests.",
            prompt_template: "Review the current changes and report concrete issues.",
        },
        RoleTemplate {
            id: "fixer",
            name: "Fixer",
            description: "Applies targeted fixes after review or failed verification.",
            prompt_template: "Fix the reported issues with the smallest safe change.",
        },
        RoleTemplate {
            id: "custom",
            name: "Custom",
            description: "Uses the workflow node prompt without a predefined role.",
            prompt_template: "",
        },
    ]
}

fn plan_parallel_fullstack_review_finalize() -> WorkflowTemplate {
    WorkflowTemplate {
        id: PLAN_PARALLEL_FULLSTACK_REVIEW_FINALIZE_ID,
        name: "Plan, Parallel Frontend & Backend, Review, Finalize",
        description: "Plans and splits the work, implements frontend and backend in parallel, reviews with tests, then commits and updates docs.",
        graph: WorkflowGraph {
            version: 2,
            nodes: vec![
                node("start", WorkflowNodeKind::Start, display_data("Start")),
                node(
                    "plan",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Plan & Split",
                        "architect",
                        "Analyze the issue and produce an implementation plan that splits the work into independent frontend and backend tracks.",
                        "CLAUDE_CODE",
                    ),
                ),
                node(
                    "frontend",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Frontend",
                        "implementer",
                        "Implement the frontend track of the plan.",
                        "GEMINI",
                    ),
                ),
                node(
                    "backend",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Backend",
                        "implementer",
                        "Implement the backend track of the plan.",
                        "CODEX",
                    ),
                ),
                node(
                    "review",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Review & Test",
                        "reviewer",
                        "Review the combined frontend and backend changes and run the test suite.",
                        "CLAUDE_CODE",
                    ),
                ),
                node(
                    "finalize",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Finalize",
                        "implementer",
                        "Commit the changes with a clear message and update the project documentation.",
                        "CLAUDE_CODE",
                    ),
                ),
                node("end", WorkflowNodeKind::End, display_data("End")),
            ],
            edges: vec![
                edge("e1", "start", "plan", WorkflowEdgeKind::Default),
                edge("e2", "plan", "frontend", WorkflowEdgeKind::Default),
                edge("e3", "plan", "backend", WorkflowEdgeKind::Default),
                edge("e4", "frontend", "review", WorkflowEdgeKind::Default),
                edge("e5", "backend", "review", WorkflowEdgeKind::Default),
                edge("e6", "review", "finalize", WorkflowEdgeKind::Default),
                edge("e7", "finalize", "end", WorkflowEdgeKind::Default),
            ],
            router_executor_config: None,
            canvas: None,
        },
    }
}

fn research_multi_perspective_synthesize() -> WorkflowTemplate {
    WorkflowTemplate {
        id: RESEARCH_MULTI_PERSPECTIVE_SYNTHESIZE_ID,
        name: "Research, Multi-Perspective Drafts, Synthesize",
        description: "Frames the research topic, drafts three independent perspective documents in parallel, then synthesizes the conclusions.",
        graph: WorkflowGraph {
            version: 2,
            nodes: vec![
                node("start", WorkflowNodeKind::Start, display_data("Start")),
                node(
                    "frame",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Frame Topic",
                        "researcher",
                        "Turn the research input from the issue into a well-scoped topic with a clear outline of the questions to answer.",
                        "CLAUDE_CODE",
                    ),
                ),
                node(
                    "draft-a",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Draft: Pragmatic",
                        "custom",
                        "Write an independent design document for the framed topic from a pragmatic perspective: the most direct solution under current constraints.",
                        "CODEX",
                    ),
                ),
                node(
                    "draft-b",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Draft: Exploratory",
                        "custom",
                        "Write an independent design document for the framed topic from an exploratory perspective: alternative approaches and novel ideas.",
                        "GEMINI",
                    ),
                ),
                node(
                    "draft-c",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Draft: Risk & Trade-offs",
                        "custom",
                        "Write an independent design document for the framed topic from a risk perspective: costs, risks, and long-term maintainability trade-offs.",
                        "CLAUDE_CODE",
                    ),
                ),
                node(
                    "synthesize",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Synthesize",
                        "custom",
                        "Compare the three perspective documents, reconcile their differences, and write the final conclusions and recommendation.",
                        "CLAUDE_CODE",
                    ),
                ),
                node("end", WorkflowNodeKind::End, display_data("End")),
            ],
            edges: vec![
                edge("e1", "start", "frame", WorkflowEdgeKind::Default),
                edge("e2", "frame", "draft-a", WorkflowEdgeKind::Default),
                edge("e3", "frame", "draft-b", WorkflowEdgeKind::Default),
                edge("e4", "frame", "draft-c", WorkflowEdgeKind::Default),
                edge("e5", "draft-a", "synthesize", WorkflowEdgeKind::Default),
                edge("e6", "draft-b", "synthesize", WorkflowEdgeKind::Default),
                edge("e7", "draft-c", "synthesize", WorkflowEdgeKind::Default),
                edge("e8", "synthesize", "end", WorkflowEdgeKind::Default),
            ],
            router_executor_config: None,
            canvas: None,
        },
    }
}

fn node(id: &str, kind: WorkflowNodeKind, data: WorkflowNodeData) -> WorkflowNode {
    WorkflowNode {
        id: id.to_string(),
        kind,
        data,
        position: None,
    }
}

fn edge(id: &str, source: &str, target: &str, kind: WorkflowEdgeKind) -> WorkflowEdge {
    WorkflowEdge {
        id: id.to_string(),
        source: source.to_string(),
        source_handle: Some("output-right".to_string()),
        target: target.to_string(),
        target_handle: Some("input-left".to_string()),
        kind,
        data: None,
    }
}

fn display_data(display_name: &str) -> WorkflowNodeData {
    WorkflowNodeData {
        display_name: Some(display_name.to_string()),
        ..WorkflowNodeData::default()
    }
}

fn agent_data(
    display_name: &str,
    role_template_id: &str,
    prompt_template: &str,
    executor: &str,
) -> WorkflowNodeData {
    WorkflowNodeData {
        display_name: Some(display_name.to_string()),
        role_template_id: Some(role_template_id.to_string()),
        executor_config: Some(json!({ "executor": executor })),
        prompt_template: Some(prompt_template.to_string()),
        output_capture: Some(AgentOutputCapture::LastMessage),
        ..WorkflowNodeData::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::validation::validate_graph;

    #[test]
    fn built_in_templates_are_valid() {
        for template in built_in_templates() {
            validate_graph(&template.graph).expect(template.name);
        }
    }

    #[test]
    fn built_in_templates_expose_only_current_poc_templates() {
        let templates = built_in_templates();

        assert_eq!(
            templates
                .iter()
                .map(|template| template.id)
                .collect::<Vec<_>>(),
            vec![
                PLAN_PARALLEL_FULLSTACK_REVIEW_FINALIZE_ID,
                RESEARCH_MULTI_PERSPECTIVE_SYNTHESIZE_ID,
            ]
        );
    }

    #[test]
    fn fullstack_template_uses_expected_default_agents() {
        let template = plan_parallel_fullstack_review_finalize();
        let executor_for = |node_id: &str| {
            template
                .graph
                .nodes
                .iter()
                .find(|node| node.id == node_id)
                .and_then(|node| node.data.executor_config.as_ref())
                .and_then(|config| config.get("executor"))
                .and_then(|value| value.as_str())
        };

        assert_eq!(executor_for("plan"), Some("CLAUDE_CODE"));
        assert_eq!(executor_for("frontend"), Some("GEMINI"));
        assert_eq!(executor_for("backend"), Some("CODEX"));
        assert_eq!(executor_for("review"), Some("CLAUDE_CODE"));
        assert_eq!(executor_for("finalize"), Some("CLAUDE_CODE"));
    }

    #[test]
    fn parallel_templates_fan_out_and_join() {
        let fullstack = plan_parallel_fullstack_review_finalize();
        let plan_targets: Vec<_> = fullstack
            .graph
            .edges
            .iter()
            .filter(|edge| edge.source == "plan")
            .map(|edge| edge.target.as_str())
            .collect();
        assert_eq!(plan_targets, vec!["frontend", "backend"]);
        let review_sources = fullstack
            .graph
            .edges
            .iter()
            .filter(|edge| edge.target == "review")
            .count();
        assert_eq!(review_sources, 2);

        let research = research_multi_perspective_synthesize();
        let frame_targets: Vec<_> = research
            .graph
            .edges
            .iter()
            .filter(|edge| edge.source == "frame")
            .map(|edge| edge.target.as_str())
            .collect();
        assert_eq!(frame_targets, vec!["draft-a", "draft-b", "draft-c"]);
        let synthesize_sources = research
            .graph
            .edges
            .iter()
            .filter(|edge| edge.target == "synthesize")
            .count();
        assert_eq!(synthesize_sources, 3);
    }

    #[test]
    fn role_templates_include_required_v1_roles() {
        let ids: Vec<_> = role_templates().iter().map(|role| role.id).collect();

        assert!(ids.contains(&"architect"));
        assert!(ids.contains(&"researcher"));
        assert!(ids.contains(&"implementer"));
        assert!(ids.contains(&"reviewer"));
        assert!(ids.contains(&"fixer"));
        assert!(ids.contains(&"custom"));
    }
}
