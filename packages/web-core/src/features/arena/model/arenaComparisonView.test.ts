import {
  AgentRunStatus,
  type AgentRunSummary,
  type RunState,
} from 'shared/types';
import { describe, expect, it } from 'vitest';
import type {
  ArenaGroupResponse,
  ArenaWorkspaceSummary,
} from '@/shared/lib/arenaApi';
import {
  buildArenaComparisonView,
  getArenaAgentRunResultSummary,
  reconcileArenaCandidateSelection,
  selectCurrentArenaAgentRun,
} from './arenaComparisonView';

function workspace(
  candidateId: string,
  purpose: ArenaWorkspaceSummary['purpose'],
  status: AgentRunStatus,
  overrides: Partial<ArenaWorkspaceSummary> = {}
): ArenaWorkspaceSummary {
  return {
    candidate_id: candidateId,
    workspace_id: `workspace-${candidateId}`,
    session_id: `session-${candidateId}`,
    name: null,
    branch: `branch-${candidateId}`,
    purpose,
    arena_status: 'active',
    executor: 'codex',
    variant: null,
    latest_agent_run_status: status,
    has_uncommitted_changes: null,
    ...overrides,
  };
}

const group: ArenaGroupResponse = {
  id: 'arena-1',
  task_id: 'task-1',
  prompt: 'Compare implementations',
  base_branch: 'main',
  mode: 'implementation',
  lifecycle_status: 'open',
  winner_candidate_id: null,
  promoted_at: null,
  closed_at: null,
  created_at: '2026-08-30T00:00:00Z',
  updated_at: '2026-08-30T00:00:00Z',
  events: [],
  workspaces: [
    workspace('candidate-a', 'attempt', AgentRunStatus.succeeded, {
      name: 'Alpha',
    }),
    workspace('candidate-b', 'synthesis', AgentRunStatus.succeeded),
    workspace('candidate-c', 'attempt', AgentRunStatus.running),
    workspace('candidate-d', 'attempt', AgentRunStatus.cancelling),
  ],
};

const labels = {
  attempt: (order: number) => `Candidate ${order}`,
  synthesis: (order: number) => `Synthesis ${order}`,
};

function run(id: string, createdAt: string, content: string | null = null) {
  const state: RunState = {
    state_schema_version: 1,
    reducer_version: 1,
    session_id: 'session',
    agent_run_id: id,
    turn_id: 'turn',
    status: AgentRunStatus.succeeded,
    projection_status: 'current',
    last_run_attempt_id: null,
    last_run_attempt_number: 1,
    last_event_sequence: 0n,
    last_event_id: null,
    provider_session: null,
    terminal_output: content
      ? {
          message_id: `message-${id}`,
          role: 'assistant',
          content,
        }
      : null,
    last_error: null,
    unknown_event_count: 0n,
    updated_at: createdAt,
  };
  return {
    agent_run_id: id,
    session_id: 'session',
    turn_id: 'turn',
    state,
    created_at: createdAt,
    updated_at: createdAt,
  } satisfies AgentRunSummary;
}

describe('Arena comparison view', () => {
  it('preserves explicit candidate identity, purpose, and server ordering', () => {
    const view = buildArenaComparisonView(group, labels);

    expect(view.candidates.map(({ candidateId }) => candidateId)).toEqual([
      'candidate-a',
      'candidate-b',
      'candidate-c',
      'candidate-d',
    ]);
    expect(view.candidates.map(({ purpose }) => purpose)).toEqual([
      'attempt',
      'synthesis',
      'attempt',
      'attempt',
    ]);
    expect(view.candidates.map(({ order }) => order)).toEqual([0, 1, 2, 3]);
    expect(view.attemptCount).toBe(3);
    expect(view.synthesisCount).toBe(1);
  });

  it('keeps a selected candidate across refresh and falls back predictably', () => {
    const candidates = buildArenaComparisonView(group, labels).candidates;

    expect(reconcileArenaCandidateSelection('candidate-b', candidates)).toBe(
      'candidate-b'
    );
    expect(reconcileArenaCandidateSelection('missing', candidates)).toBe(
      'candidate-a'
    );
    expect(reconcileArenaCandidateSelection(null, [])).toBeNull();
  });

  it('allows a successful synthesis result to become the winner', () => {
    const synthesis = buildArenaComparisonView(group, labels).candidates[1];

    expect(synthesis).toMatchObject({
      purpose: 'synthesis',
      isSuccessful: true,
      canSelectWinner: true,
    });
  });

  it('separates active status from canonical cancellation eligibility', () => {
    const view = buildArenaComparisonView(group, labels);

    expect(view.activeCount).toBe(2);
    expect(view.cancellableSessionIds).toEqual(['session-candidate-c']);
    expect(view.candidates[3]).toMatchObject({
      agentRunStatus: AgentRunStatus.cancelling,
      canCancel: false,
    });
  });

  it('derives close, dissolve, retry, and winner gates from canonical state', () => {
    const openView = buildArenaComparisonView(
      {
        ...group,
        workspaces: [
          workspace('candidate-a', 'attempt', AgentRunStatus.failed),
        ],
      },
      labels
    );
    expect(openView.canClose).toBe(true);
    expect(openView.canDissolve).toBe(true);
    expect(openView.candidates[0].canRetry).toBe(true);

    const closedView = buildArenaComparisonView(
      {
        ...group,
        lifecycle_status: 'closed',
      },
      labels
    );
    expect(closedView.canClose).toBe(false);
    expect(
      closedView.candidates.every(({ canSelectWinner }) => !canSelectWinner)
    ).toBe(true);

    const adoptedView = buildArenaComparisonView(
      {
        ...group,
        winner_candidate_id: 'candidate-a',
      },
      labels
    );
    expect(adoptedView.canDissolve).toBe(false);
    expect(adoptedView.candidates[0].isWinner).toBe(true);
  });

  it('does not offer retry for a successful attempt', () => {
    const view = buildArenaComparisonView(group, labels);

    expect(view.candidates[0].canRetry).toBe(false);
    expect(view.candidates[2].canRetry).toBe(false);
  });

  it('selects the latest canonical AgentRun with a stable id tie-breaker', () => {
    const selected = selectCurrentArenaAgentRun([
      run('run-a', '2026-08-30T01:00:00Z'),
      run('run-c', '2026-08-30T02:00:00Z'),
      run('run-b', '2026-08-30T02:00:00Z'),
    ]);

    expect(selected?.agent_run_id).toBe('run-c');
    expect(selectCurrentArenaAgentRun([])).toBeNull();
  });

  it('projects a trimmed terminal output as the result summary', () => {
    expect(
      getArenaAgentRunResultSummary(
        run('run-result', '2026-08-30T02:00:00Z', '  Final result  ')
      )
    ).toBe('Final result');
    expect(
      getArenaAgentRunResultSummary(
        run('run-empty', '2026-08-30T02:00:00Z', '   ')
      )
    ).toBeNull();
  });
});
