import type { AgentEventEnvelope, RunState } from 'shared/types';
import { isCanonicalProjectionAvailable } from './canonicalAgentTimeline';

export type CanonicalAgentRunAction =
  | 'cancel'
  | 'submit_input'
  | 'resolve_approval'
  | 'retry'
  | 'resume';

export type CanonicalAgentRunActionBlockedReason =
  | 'state_unavailable'
  | 'projection_degraded'
  | 'runtime_busy'
  | 'runtime_terminal'
  | 'input_not_requested'
  | 'approval_not_requested'
  | 'backend_gate_unavailable';

export interface CanonicalAgentRunActionDecision {
  readonly action: CanonicalAgentRunAction;
  readonly allowed: boolean;
  readonly reason: CanonicalAgentRunActionBlockedReason | null;
  readonly controlId: string | null;
}

export type CanonicalAgentRunActionPolicy = Record<
  CanonicalAgentRunAction,
  CanonicalAgentRunActionDecision
>;

export type CanonicalAgentRunPendingControl =
  | {
      readonly kind: 'input';
      readonly controlId: string;
      readonly prompt: string;
    }
  | {
      readonly kind: 'approval';
      readonly controlId: string;
      readonly toolName: string;
    };

function allow(
  action: CanonicalAgentRunAction,
  controlId: string | null = null
): CanonicalAgentRunActionDecision {
  return { action, allowed: true, reason: null, controlId };
}

function block(
  action: CanonicalAgentRunAction,
  reason: CanonicalAgentRunActionBlockedReason
): CanonicalAgentRunActionDecision {
  return { action, allowed: false, reason, controlId: null };
}

export function findLatestUnresolvedCanonicalControl(
  events: readonly AgentEventEnvelope[],
  kind: 'input' | 'approval'
): CanonicalAgentRunPendingControl | null {
  const pending = new Map<
    string,
    { index: number; control: CanonicalAgentRunPendingControl }
  >();
  const resolved = new Set<string>();

  for (const [index, event] of events.entries()) {
    const payload = event.payload;
    if (kind === 'input') {
      if (payload.type === 'input_requested') {
        const id = payload.data.input_id;
        if (!resolved.has(id)) {
          pending.set(id, {
            index,
            control: {
              kind: 'input',
              controlId: id,
              prompt: payload.data.prompt,
            },
          });
        }
      } else if (payload.type === 'input_resolved') {
        resolved.add(payload.data.input_id);
        pending.delete(payload.data.input_id);
      }
    } else if (payload.type === 'approval_requested') {
      const id = payload.data.approval_id;
      if (!resolved.has(id)) {
        pending.set(id, {
          index,
          control: {
            kind: 'approval',
            controlId: id,
            toolName: payload.data.tool_name,
          },
        });
      }
    } else if (payload.type === 'approval_resolved') {
      resolved.add(payload.data.approval_id);
      pending.delete(payload.data.approval_id);
    }
  }

  let latest: {
    index: number;
    control: CanonicalAgentRunPendingControl;
  } | null = null;
  for (const candidate of pending.values()) {
    if (!latest || candidate.index > latest.index) latest = candidate;
  }
  return latest?.control ?? null;
}

/**
 * Project canonical state into frontend action visibility. Retry and resume
 * remain fail-closed until the backend exposes their capability-aware gates.
 */
export function deriveCanonicalAgentRunActionPolicy(
  state: RunState | null,
  events: readonly AgentEventEnvelope[]
): CanonicalAgentRunActionPolicy {
  if (!state) {
    return unavailablePolicy('state_unavailable');
  }
  if (!isCanonicalProjectionAvailable(state)) {
    return unavailablePolicy('projection_degraded');
  }

  const input = findLatestUnresolvedCanonicalControl(events, 'input');
  const approval = findLatestUnresolvedCanonicalControl(events, 'approval');
  const terminal =
    state.status === 'succeeded' ||
    state.status === 'failed' ||
    state.status === 'cancelled' ||
    state.status === 'crashed' ||
    state.status === 'audit_failed';
  const canCancel =
    state.status === 'pending' ||
    state.status === 'starting' ||
    state.status === 'running' ||
    state.status === 'awaiting_input' ||
    state.status === 'awaiting_approval';

  return {
    cancel: canCancel
      ? allow('cancel')
      : block('cancel', terminal ? 'runtime_terminal' : 'runtime_busy'),
    submit_input:
      state.status === 'awaiting_input' && input
        ? allow('submit_input', input.controlId)
        : block('submit_input', 'input_not_requested'),
    resolve_approval:
      state.status === 'awaiting_approval' && approval
        ? allow('resolve_approval', approval.controlId)
        : block('resolve_approval', 'approval_not_requested'),
    retry: block('retry', 'backend_gate_unavailable'),
    resume: block('resume', 'backend_gate_unavailable'),
  };
}

function unavailablePolicy(
  reason: Extract<
    CanonicalAgentRunActionBlockedReason,
    'state_unavailable' | 'projection_degraded'
  >
): CanonicalAgentRunActionPolicy {
  return {
    cancel: block('cancel', reason),
    submit_input: block('submit_input', reason),
    resolve_approval: block('resolve_approval', reason),
    retry: block('retry', reason),
    resume: block('resume', reason),
  };
}
