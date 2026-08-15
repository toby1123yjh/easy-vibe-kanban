import { describe, expect, it } from 'vitest';
import type { AgentRunSummary, RunState } from 'shared/types';
import { buildCanonicalAgentSessionTimeline } from './canonicalAgentSessionTimeline';

const state = (
  status: RunState['status'],
  projection_status: RunState['projection_status'] = 'current'
) =>
  ({
    state_schema_version: 1,
    reducer_version: 1,
    session_id: 'session-1',
    agent_run_id: 'run',
    turn_id: 'turn',
    status,
    projection_status,
    last_run_attempt_id: null,
    last_run_attempt_number: 1,
    last_event_sequence: 0n,
    last_event_id: null,
    provider_session: null,
    terminal_output: null,
    last_error: null,
    unknown_event_count: 0n,
    updated_at: '2026-08-13T00:00:00Z',
  }) as RunState;

const summary = (
  id: string,
  created_at: string,
  status: RunState['status']
): AgentRunSummary => ({
  agent_run_id: id,
  session_id: 'session-1',
  turn_id: `turn-${id}`,
  state: { ...state(status), agent_run_id: id },
  created_at,
  updated_at: created_at,
});

describe('buildCanonicalAgentSessionTimeline', () => {
  it('deduplicates and orders runs while selecting the latest active run', () => {
    const projection = buildCanonicalAgentSessionTimeline('session-1', [
      summary('run-2', '2026-08-13T00:02:00Z', 'running'),
      summary('run-1', '2026-08-13T00:01:00Z', 'succeeded'),
      summary('run-2', '2026-08-13T00:02:00Z', 'running'),
    ]);

    expect(projection.runs.map((run) => run.summary.agent_run_id)).toEqual([
      'run-1',
      'run-2',
    ]);
    expect(projection.activeRun?.summary.agent_run_id).toBe('run-2');
    expect(projection.isRunning).toBe(true);
    expect(projection.isTerminal).toBe(false);
  });

  it('ignores another session and exposes degraded state', () => {
    const other = {
      ...summary('other', '2026-08-13T00:01:00Z', 'failed'),
      session_id: 'other',
    };
    const degraded = {
      ...summary('run-1', '2026-08-13T00:02:00Z', 'succeeded'),
      state: {
        ...state('succeeded', 'projection_degraded'),
        agent_run_id: 'run-1',
      },
    };
    const projection = buildCanonicalAgentSessionTimeline('session-1', [
      other,
      degraded,
    ]);

    expect(projection.runs).toHaveLength(1);
    expect(projection.isTerminal).toBe(true);
    expect(projection.projectionDegraded).toBe(true);
  });
});
