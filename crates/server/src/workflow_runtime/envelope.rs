use std::borrow::Cow;

pub const MAX_WORKFLOW_ENVELOPE_INPUT_CHARS: usize = 8_000;
pub const MAX_WORKFLOW_ENVELOPE_HANDOFF_CHARS: usize = 12_000;

pub struct WorkflowEnvelopeUpstream<'a> {
    pub heading: Cow<'a, str>,
    pub body: Cow<'a, str>,
}

pub struct WorkflowAgentEnvelope<'a> {
    pub node_type_label: &'a str,
    pub node_name: &'a str,
    pub node_id: &'a str,
    pub workflow_input: &'a str,
    pub upstream_handoff: &'a [WorkflowEnvelopeUpstream<'a>],
    pub node_task: &'a str,
    pub handoff_contract: &'a str,
}

pub fn render_workflow_agent_envelope(envelope: WorkflowAgentEnvelope<'_>) -> String {
    let mut output = String::new();
    output.push_str("# Workflow Agent Envelope\n\n");
    output.push_str("This message is the explicit runtime context for one workflow node. ");
    output.push_str(
        "The saved node prompt or runtime node task is preserved under `Node Task`; the surrounding sections are workflow handoff context.\n\n",
    );

    output.push_str("## Current Node\n");
    output.push_str(&format!(
        "- Type: {}\n- Name: {}\n- ID: {}\n\n",
        envelope.node_type_label, envelope.node_name, envelope.node_id
    ));

    output.push_str("## Workflow Input\n");
    let workflow_input = envelope.workflow_input.trim();
    if workflow_input.is_empty() {
        output.push_str("No workflow input was provided.\n\n");
    } else {
        output.push_str(&truncate_for_workflow_envelope(
            workflow_input,
            MAX_WORKFLOW_ENVELOPE_INPUT_CHARS,
        ));
        output.push_str("\n\n");
    }

    output.push_str("## Direct Upstream Handoff\n");
    if envelope.upstream_handoff.is_empty() {
        output.push_str("No direct upstream node has produced output for this node.\n\n");
    } else {
        for upstream in envelope.upstream_handoff {
            output.push_str(&format!("### {}\n", upstream.heading.trim()));
            let body = upstream.body.trim();
            if body.is_empty() {
                output.push_str("<empty>\n\n");
            } else {
                output.push_str(&truncate_for_workflow_envelope(
                    body,
                    MAX_WORKFLOW_ENVELOPE_HANDOFF_CHARS,
                ));
                output.push_str("\n\n");
            }
        }
    }

    output.push_str("## Node Task\n");
    let node_task = envelope.node_task.trim();
    if node_task.is_empty() {
        output.push_str("No explicit task prompt was configured for this node.\n\n");
    } else {
        output.push_str(node_task);
        output.push_str("\n\n");
    }

    output.push_str("## Handoff Contract\n");
    let handoff_contract = envelope.handoff_contract.trim();
    if handoff_contract.is_empty() {
        output.push_str("No additional handoff contract was configured for this node.");
    } else {
        output.push_str(handoff_contract);
    }

    output
}

fn truncate_for_workflow_envelope(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let truncated = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}\n[truncated to {max_chars} characters]")
    } else {
        value.to_string()
    }
}
