import type {
  AgentEventEnvelope,
  AgentEventPayload,
  RunState,
} from 'shared/types';
import { describe, expect, it } from 'vitest';
import {
  deriveCanonicalAgentRunActionPolicy,
  findLatestUnresolvedCanonicalControl,
} from './canonicalAgentActions';

const state: RunState = {
  state_schema_version: 1,
  reducer_version: 1,
  session_id: 'session',
  agent_run_id: 'run',
  turn_id: 'turn',
  status: 'running',
  projection_status: 'current',
  last_run_attempt_id: 'attempt',
  last_run_attempt_number: 1,
  last_event_sequence: 0,
  last_event_id: null,
  provider_session: null,
  terminal_output: null,
  last_error: null,
  unknown_event_count: 0,
  updated_at: '2026-08-14T00:00:00Z',
};

function event(
  sequence: number,
  payload: AgentEventPayload
): AgentEventEnvelope {
  return {
    schema_version: 1,
    payload_version: 1,
    event_id: `event-${sequence}`,
    session_id: 'session',
    agent_run_id: 'run',
    turn_id: 'turn',
    run_attempt_id: 'attempt',
    run_attempt_number: 1,
    sequence,
    correlation_id: 'correlation',
    timestamp: '2026-08-14T00:00:00Z',
    native_refs: [],
    payload,
  };
}

describe('deriveCanonicalAgentRunActionPolicy', () => {
  it('fails closed when state is unavailable or degraded', () => {
    expect(deriveCanonicalAgentRunActionPolicy(null, []).cancel.reason).toBe(
      'state_unavailable'
    );
    expect(
      deriveCanonicalAgentRunActionPolicy(
        { ...state, projection_status: 'projection_degraded' },
        []
      ).cancel.reason
    ).toBe('projection_degraded');
  });

  it('allows cancel only for active non-terminal states', () => {
    expect(deriveCanonicalAgentRunActionPolicy(state, []).cancel.allowed).toBe(
      true
    );
    expect(
      deriveCanonicalAgentRunActionPolicy({ ...state, status: 'cancelled' }, [])
        .cancel.reason
    ).toBe('runtime_terminal');
  });

  it('addresses an unresolved approval by its canonical control id', () => {
    const request = event(1, {
      type: 'approval_requested',
      data: {
        approval_id: 'approval-1',
        tool_call_id: 'tool-1',
        tool_name: 'Write',
      },
    });
    const policy = deriveCanonicalAgentRunActionPolicy(
      { ...state, status: 'awaiting_approval' },
      [request]
    );

    expect(policy.resolve_approval).toMatchObject({
      allowed: true,
      controlId: 'approval-1',
    });
  });

  it('keeps resolved controls closed across duplicate and late events', () => {
    const request = event(1, {
      type: 'approval_requested',
      data: { approval_id: 'approval-1', tool_name: 'Write' },
    });
    const resolved = event(2, {
      type: 'approval_resolved',
      data: { approval_id: 'approval-1', approved: true },
    });
    const lateDuplicate = event(3, request.payload);

    expect(
      findLatestUnresolvedCanonicalControl(
        [request, request, resolved, lateDuplicate],
        'approval'
      )
    ).toBeNull();
    expect(
      deriveCanonicalAgentRunActionPolicy(
        { ...state, status: 'awaiting_approval' },
        [request, resolved]
      ).resolve_approval.reason
    ).toBe('approval_not_requested');
  });

  it('finds the latest unresolved input and closes it when resolved', () => {
    const first = event(1, {
      type: 'input_requested',
      data: { input_id: 'input-1', prompt: 'First?' },
    });
    const second = event(2, {
      type: 'input_requested',
      data: { input_id: 'input-2', prompt: 'Second?' },
    });
    const resolved = event(3, {
      type: 'input_resolved',
      data: { input_id: 'input-2', answered: true },
    });

    expect(
      deriveCanonicalAgentRunActionPolicy(
        { ...state, status: 'awaiting_input' },
        [first, second]
      ).submit_input.controlId
    ).toBe('input-2');
    expect(
      findLatestUnresolvedCanonicalControl([first, second, resolved], 'input')
    ).toMatchObject({ controlId: 'input-1', prompt: 'First?' });
  });
});
