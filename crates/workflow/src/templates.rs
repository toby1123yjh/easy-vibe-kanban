use crate::graph::{
    AgentOutputCapture, ArenaApplyStrategy, ArenaAttemptConfig, ArenaPromoteStrategy,
    HumanGateAction, WorkflowEdge, WorkflowEdgeKind, WorkflowGraph, WorkflowNode, WorkflowNodeData,
    WorkflowNodeKind,
};

// Stable system template ids. These ids are persisted by workflow_runs.workflow_id.
const PLAN_APPROVE_IMPLEMENT_REVIEW_ID: &str = "8f1f2f0c-0e58-4c7c-8dc1-000000000001";
const PLAN_ARENA_PICK_WINNER_REVIEW_ID: &str = "8f1f2f0c-0e58-4c7c-8dc1-000000000002";
const RESEARCH_ARCHITECT_IMPLEMENT_REVIEW_FIX_ID: &str = "8f1f2f0c-0e58-4c7c-8dc1-000000000003";
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
        plan_approve_implement_review(),
        plan_arena_pick_winner_review(),
        research_architect_implement_review_fix(),
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

fn plan_approve_implement_review() -> WorkflowTemplate {
    WorkflowTemplate {
        id: PLAN_APPROVE_IMPLEMENT_REVIEW_ID,
        name: "Plan, Approve, Implement, Review",
        description: "Creates a plan, pauses for approval, then implements and reviews.",
        graph: WorkflowGraph {
            version: 2,
            nodes: vec![
                node("start", WorkflowNodeKind::Start, display_data("Start")),
                node(
                    "plan",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Plan",
                        "architect",
                        "Create a concise implementation plan for the issue.",
                    ),
                ),
                node(
                    "approval",
                    WorkflowNodeKind::HumanGate,
                    human_gate_data("Approve plan"),
                ),
                node(
                    "implement",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Implement",
                        "implementer",
                        "Implement the approved plan in the workflow worktree.",
                    ),
                ),
                node(
                    "review",
                    WorkflowNodeKind::Agent,
                    agent_data("Review", "reviewer", "Review the implementation."),
                ),
                node("end", WorkflowNodeKind::End, display_data("End")),
            ],
            edges: vec![
                edge("e1", "start", "plan", WorkflowEdgeKind::Default),
                edge("e2", "plan", "approval", WorkflowEdgeKind::Default),
                edge("e3", "approval", "implement", WorkflowEdgeKind::Approval),
                edge("e4", "approval", "end", WorkflowEdgeKind::Rejection),
                edge("e5", "implement", "review", WorkflowEdgeKind::Default),
                edge("e6", "review", "end", WorkflowEdgeKind::Default),
            ],
            router_executor_config: None,
            canvas: None,
        },
    }
}

fn plan_arena_pick_winner_review() -> WorkflowTemplate {
    WorkflowTemplate {
        id: PLAN_ARENA_PICK_WINNER_REVIEW_ID,
        name: "Plan, Arena, Pick Winner, Review",
        description: "Plans once, creates parallel Arena attempts, then reviews the selected winner.",
        graph: WorkflowGraph {
            version: 2,
            nodes: vec![
                node("start", WorkflowNodeKind::Start, display_data("Start")),
                node(
                    "plan",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Plan",
                        "architect",
                        "Create an implementation plan suitable for multiple candidate attempts.",
                    ),
                ),
                node(
                    "arena",
                    WorkflowNodeKind::Arena,
                    arena_data("Arena implementation"),
                ),
                node(
                    "review",
                    WorkflowNodeKind::Agent,
                    agent_data("Review", "reviewer", "Review the selected Arena winner."),
                ),
                node("end", WorkflowNodeKind::End, display_data("End")),
            ],
            edges: vec![
                edge("e1", "start", "plan", WorkflowEdgeKind::Default),
                edge("e2", "plan", "arena", WorkflowEdgeKind::Default),
                edge("e3", "arena", "review", WorkflowEdgeKind::ArenaWinner),
                edge("e4", "review", "end", WorkflowEdgeKind::Default),
            ],
            router_executor_config: None,
            canvas: None,
        },
    }
}

fn research_architect_implement_review_fix() -> WorkflowTemplate {
    WorkflowTemplate {
        id: RESEARCH_ARCHITECT_IMPLEMENT_REVIEW_FIX_ID,
        name: "Research, Architect, Implement, Review, Fix",
        description: "Gathers context, designs, implements, reviews, and applies a final fix step.",
        graph: WorkflowGraph {
            version: 2,
            nodes: vec![
                node("start", WorkflowNodeKind::Start, display_data("Start")),
                node(
                    "research",
                    WorkflowNodeKind::Agent,
                    agent_data("Research", "researcher", "Research the issue and codebase."),
                ),
                node(
                    "architect",
                    WorkflowNodeKind::Agent,
                    agent_data("Architect", "architect", "Design the implementation."),
                ),
                node(
                    "implement",
                    WorkflowNodeKind::Agent,
                    agent_data("Implement", "implementer", "Implement the design."),
                ),
                node(
                    "review",
                    WorkflowNodeKind::Agent,
                    agent_data("Review", "reviewer", "Review the implementation."),
                ),
                node(
                    "fix",
                    WorkflowNodeKind::Agent,
                    agent_data("Fix", "fixer", "Fix concrete issues found during review."),
                ),
                node("end", WorkflowNodeKind::End, display_data("End")),
            ],
            edges: vec![
                edge("e1", "start", "research", WorkflowEdgeKind::Default),
                edge("e2", "research", "architect", WorkflowEdgeKind::Default),
                edge("e3", "architect", "implement", WorkflowEdgeKind::Default),
                edge("e4", "implement", "review", WorkflowEdgeKind::Default),
                edge("e5", "review", "end", WorkflowEdgeKind::Default),
                edge("e6", "review", "fix", WorkflowEdgeKind::Rejection),
                edge("e7", "fix", "end", WorkflowEdgeKind::Default),
            ],
            router_executor_config: None,
            canvas: None,
        },
    }
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
                    ),
                ),
                node(
                    "frontend",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Frontend",
                        "implementer",
                        "Implement the frontend track of the plan.",
                    ),
                ),
                node(
                    "backend",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Backend",
                        "implementer",
                        "Implement the backend track of the plan.",
                    ),
                ),
                node(
                    "review",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Review & Test",
                        "reviewer",
                        "Review the combined frontend and backend changes and run the test suite.",
                    ),
                ),
                node(
                    "finalize",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Finalize",
                        "implementer",
                        "Commit the changes with a clear message and update the project documentation.",
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
                    ),
                ),
                node(
                    "draft-a",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Draft: Pragmatic",
                        "custom",
                        "Write an independent design document for the framed topic from a pragmatic perspective: the most direct solution under current constraints.",
                    ),
                ),
                node(
                    "draft-b",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Draft: Exploratory",
                        "custom",
                        "Write an independent design document for the framed topic from an exploratory perspective: alternative approaches and novel ideas.",
                    ),
                ),
                node(
                    "draft-c",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Draft: Risk & Trade-offs",
                        "custom",
                        "Write an independent design document for the framed topic from a risk perspective: costs, risks, and long-term maintainability trade-offs.",
                    ),
                ),
                node(
                    "synthesize",
                    WorkflowNodeKind::Agent,
                    agent_data(
                        "Synthesize",
                        "custom",
                        "Compare the three perspective documents, reconcile their differences, and write the final conclusions and recommendation.",
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
) -> WorkflowNodeData {
    WorkflowNodeData {
        display_name: Some(display_name.to_string()),
        role_template_id: Some(role_template_id.to_string()),
        prompt_template: Some(prompt_template.to_string()),
        output_capture: Some(AgentOutputCapture::LastMessage),
        ..WorkflowNodeData::default()
    }
}

fn human_gate_data(display_name: &str) -> WorkflowNodeData {
    WorkflowNodeData {
        display_name: Some(display_name.to_string()),
        prompt_to_human: Some("Approve or reject the workflow plan.".to_string()),
        required_action: Some(HumanGateAction::ApproveOrReject),
        ..WorkflowNodeData::default()
    }
}

fn arena_data(display_name: &str) -> WorkflowNodeData {
    WorkflowNodeData {
        display_name: Some(display_name.to_string()),
        attempts: Some(vec![
            arena_attempt("attempt-1", "Candidate A"),
            arena_attempt("attempt-2", "Candidate B"),
            arena_attempt("attempt-3", "Candidate C"),
        ]),
        prompt_template: Some("Create an independent implementation candidate.".to_string()),
        promote_strategy: Some(ArenaPromoteStrategy::Manual),
        apply_strategy: Some(ArenaApplyStrategy::DiffApply),
        ..WorkflowNodeData::default()
    }
}

fn arena_attempt(id: &str, display_name: &str) -> ArenaAttemptConfig {
    ArenaAttemptConfig {
        id: Some(id.to_string()),
        display_name: Some(display_name.to_string()),
        role_template_id: Some("implementer".to_string()),
        prompt_template: Some("Implement this candidate independently.".to_string()),
        ..ArenaAttemptConfig::default()
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
