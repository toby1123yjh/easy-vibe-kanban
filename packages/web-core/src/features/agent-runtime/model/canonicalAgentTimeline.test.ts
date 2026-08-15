import type { AgentEventEnvelope, RunState } from 'shared/types';
import { describe, expect, it } from 'vitest';
import {
  emptyCanonicalAgentTimeline,
  isCanonicalAgentRunTerminal,
  mergeCanonicalAgentTimeline,
} from './canonicalAgentTimeline';

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
  last_event_sequence: 1,
  last_event_id: 'event-1',
  provider_session: null,
  terminal_output: null,
  last_error: null,
  unknown_event_count: 0,
  updated_at: '2026-08-12T00:00:00Z',
};

const event = (
  sequence: number,
  eventId = `event-${sequence}`
): AgentEventEnvelope => ({
  schema_version: 1,
  payload_version: 1,
  event_id: eventId,
  session_id: 'session',
  agent_run_id: 'run',
  turn_id: 'turn',
  run_attempt_id: 'attempt',
  run_attempt_number: 1,
  sequence,
  correlation_id: 'correlation',
  timestamp: '2026-08-12T00:00:00Z',
  native_refs: [],
  payload: {
    type: 'message',
    data: {
      message: {
        message_id: eventId,
        role: 'assistant',
        content: `message ${sequence}`,
      },
      final_output: sequence === 2,
    },
  },
});

describe('mergeCanonicalAgentTimeline', () => {
  it('replays and deduplicates by event identity while preserving cursor order', () => {
    const first = mergeCanonicalAgentTimeline(
      emptyCanonicalAgentTimeline(),
      [event(2), event(1)],
      state
    );
    const second = mergeCanonicalAgentTimeline(first, [
      event(1),
      event(2),
      event(3),
    ]);

    expect(second.events.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    expect(second.items.map((entry) => entry.content)).toEqual([
      'message 1',
      'message 2',
      'message 3',
    ]);
    expect(second.cursor).toEqual({ run_attempt_number: 1, sequence: 3 });
  });

  it('keeps unknown/degraded events visible as canonical items', () => {
    const degraded = {
      ...event(1, 'degraded'),
      payload: {
        type: 'unknown',
        data: { event_type: 'future_event', payload: {} },
      },
    } as AgentEventEnvelope;
    const timeline = mergeCanonicalAgentTimeline(
      emptyCanonicalAgentTimeline(),
      [degraded],
      {
        ...state,
        projection_status: 'projection_degraded',
        unknown_event_count: 1,
      }
    );

    expect(timeline.items[0]?.kind).toBe('unknown');
    expect(timeline.state?.projection_status).toBe('projection_degraded');
  });
});

describe('isCanonicalAgentRunTerminal', () => {
  it('recognizes crash and audit failure as terminal', () => {
    expect(isCanonicalAgentRunTerminal({ ...state, status: 'crashed' })).toBe(
      true
    );
    expect(
      isCanonicalAgentRunTerminal({ ...state, status: 'audit_failed' })
    ).toBe(true);
    expect(isCanonicalAgentRunTerminal(state)).toBe(false);
  });
});
