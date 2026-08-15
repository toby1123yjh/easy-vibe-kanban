import { describe, expect, it } from 'vitest';
import {
  AgentRuntimeToolStatus,
  type AgentEventEnvelope,
  type AgentEventPayload,
  type AgentRunSummary,
  type RunState,
} from 'shared/types';
import { projectCanonicalAgentConversation } from './canonicalAgentConversation';
import { buildCanonicalAgentSessionTimeline } from './canonicalAgentSessionTimeline';
import {
  emptyCanonicalAgentTimeline,
  mergeCanonicalAgentTimeline,
} from './canonicalAgentTimeline';

const SESSION_ID = 'session-1';

function state(runId: string, status: RunState['status']): RunState {
  return {
    state_schema_version: 1,
    reducer_version: 1,
    session_id: SESSION_ID,
    agent_run_id: runId,
    turn_id: `turn-${runId}`,
    status,
    projection_status: 'current',
    last_run_attempt_id: `attempt-${runId}`,
    last_run_attempt_number: 1,
    last_event_sequence: 0n,
    last_event_id: null,
    provider_session: null,
    terminal_output: null,
    last_error: null,
    unknown_event_count: 0n,
    updated_at: '2026-08-14T00:00:00Z',
  };
}

function event(
  runId: string,
  sequence: number,
  payload: AgentEventPayload
): AgentEventEnvelope {
  return {
    schema_version: 1,
    payload_version: 1,
    event_id: `${runId}-event-${sequence}`,
    session_id: SESSION_ID,
    agent_run_id: runId,
    turn_id: `turn-${runId}`,
    run_attempt_id: `attempt-${runId}`,
    run_attempt_number: 1,
    sequence: BigInt(sequence),
    correlation_id: `correlation-${runId}`,
    timestamp: `2026-08-14T00:00:${String(sequence).padStart(2, '0')}Z`,
    native_refs: [],
    payload,
  };
}

function projectRuns(
  runs: Array<{
    runId: string;
    status: RunState['status'];
    events: AgentEventEnvelope[];
  }>
) {
  const summaries: AgentRunSummary[] = [];
  const timelines = new Map();

  runs.forEach((run, index) => {
    const runState = state(run.runId, run.status);
    summaries.push({
      agent_run_id: run.runId,
      session_id: SESSION_ID,
      turn_id: `turn-${run.runId}`,
      state: runState,
      created_at: `2026-08-14T00:0${index}:00Z`,
      updated_at: `2026-08-14T00:0${index}:00Z`,
    });
    timelines.set(
      run.runId,
      mergeCanonicalAgentTimeline(
        emptyCanonicalAgentTimeline(),
        run.events,
        runState
      )
    );
  });

  return projectCanonicalAgentConversation(
    buildCanonicalAgentSessionTimeline(SESSION_ID, summaries, timelines)
  );
}

describe('projectCanonicalAgentConversation', () => {
  it('projects canonical messages without inventing execution-process identity', () => {
    const runId = 'run-message';
    const projection = projectRuns([
      {
        runId,
        status: 'succeeded',
        events: [
          event(runId, 1, {
            type: 'message',
            data: {
              message: {
                message_id: 'user-1',
                role: 'user',
                content: 'Build it',
              },
              final_output: false,
            },
          }),
          event(runId, 2, {
            type: 'message',
            data: {
              message: {
                message_id: 'assistant-1',
                role: 'assistant',
                content: 'Hel',
              },
              final_output: false,
            },
          }),
          event(runId, 3, {
            type: 'message',
            data: {
              message: {
                message_id: 'assistant-1',
                role: 'assistant',
                content: 'Hello',
              },
              final_output: true,
            },
          }),
        ],
      },
    ]);

    expect(
      projection.entries.map((entry) => ({
        type:
          entry.type === 'NORMALIZED_ENTRY'
            ? entry.content.entry_type.type
            : entry.type,
        content: entry.type === 'NORMALIZED_ENTRY' ? entry.content.content : '',
      }))
    ).toEqual([
      { type: 'user_message', content: 'Build it' },
      { type: 'assistant_message', content: 'Hello' },
    ]);
    expect(
      projection.entries.every(
        (entry) => entry.executionProcessId === undefined
      )
    ).toBe(true);
  });

  it('aggregates tools by run and tool-call id and closes them at terminal state', () => {
    const firstRun = 'run-tool-1';
    const secondRun = 'run-tool-2';
    const projection = projectRuns([
      {
        runId: firstRun,
        status: 'succeeded',
        events: [
          event(firstRun, 1, {
            type: 'tool_call',
            data: {
              tool_call_id: 'shared-tool-id',
              tool_name: 'Shell',
              status: AgentRuntimeToolStatus.running,
              arguments: { command: 'pwd' },
              result: null,
            },
          }),
          event(firstRun, 2, {
            type: 'tool_call',
            data: {
              tool_call_id: 'shared-tool-id',
              tool_name: 'Shell',
              status: AgentRuntimeToolStatus.succeeded,
              arguments: { command: 'pwd' },
              result: '/workspace',
            },
          }),
        ],
      },
      {
        runId: secondRun,
        status: 'succeeded',
        events: [
          event(secondRun, 1, {
            type: 'tool_call',
            data: {
              tool_call_id: 'shared-tool-id',
              tool_name: 'Shell',
              status: AgentRuntimeToolStatus.running,
              arguments: { command: 'ls' },
              result: null,
            },
          }),
        ],
      },
    ]);
    const tools = projection.entries.filter(
      (entry) =>
        entry.type === 'NORMALIZED_ENTRY' &&
        entry.content.entry_type.type === 'tool_use'
    );

    expect(tools).toHaveLength(2);
    expect(tools.map((entry) => entry.canonical?.agentRunId)).toEqual([
      firstRun,
      secondRun,
    ]);
    expect(tools[0]?.canonical?.eventIds).toHaveLength(2);
    expect(tools.every((entry) => entry.canonical?.active === false)).toBe(
      true
    );
  });

  it('resolves canonical approval and input controls in place', () => {
    const runId = 'run-control';
    const projection = projectRuns([
      {
        runId,
        status: 'succeeded',
        events: [
          event(runId, 1, {
            type: 'approval_requested',
            data: {
              approval_id: 'approval-1',
              tool_call_id: null,
              tool_name: 'Write',
            },
          }),
          event(runId, 2, {
            type: 'approval_resolved',
            data: {
              approval_id: 'approval-1',
              approved: false,
              reason: 'Not now',
            },
          }),
          event(runId, 3, {
            type: 'input_requested',
            data: { input_id: 'input-1', prompt: 'Which branch?' },
          }),
          event(runId, 4, {
            type: 'input_resolved',
            data: { input_id: 'input-1', answered: true },
          }),
        ],
      },
    ]);
    const controls = projection.entries.filter(
      (entry) =>
        entry.type === 'NORMALIZED_ENTRY' &&
        entry.content.entry_type.type === 'tool_use'
    );

    expect(controls).toHaveLength(2);
    if (
      controls[0]?.type !== 'NORMALIZED_ENTRY' ||
      controls[0].content.entry_type.type !== 'tool_use' ||
      controls[1]?.type !== 'NORMALIZED_ENTRY' ||
      controls[1].content.entry_type.type !== 'tool_use'
    ) {
      throw new Error('Expected canonical control entries');
    }
    expect(controls[0].content.entry_type.status).toEqual({
      status: 'denied',
      reason: 'Not now',
    });
    expect(controls[0].canonical?.eventIds).toHaveLength(2);
    expect(controls[1].content.entry_type.status).toEqual({
      status: 'success',
    });
    expect(controls[1].canonical?.eventIds).toHaveLength(2);
  });

  it('reports token totals without inventing a context window', () => {
    const runId = 'run-usage';
    const projection = projectRuns([
      {
        runId,
        status: 'succeeded',
        events: [
          event(runId, 1, {
            type: 'token_usage',
            data: {
              input_tokens: 12n,
              output_tokens: 5n,
              cached_input_tokens: 3n,
            },
          }),
        ],
      },
    ]);
    const usage = projection.entries.find(
      (entry) =>
        entry.type === 'NORMALIZED_ENTRY' &&
        entry.content.entry_type.type === 'token_usage_info'
    );

    if (
      usage?.type !== 'NORMALIZED_ENTRY' ||
      usage.content.entry_type.type !== 'token_usage_info'
    ) {
      throw new Error('Expected token usage entry');
    }
    expect(usage.content.entry_type.total_tokens).toBe(17);
    expect(usage.content.entry_type.model_context_window).toBe(0);
  });
});
