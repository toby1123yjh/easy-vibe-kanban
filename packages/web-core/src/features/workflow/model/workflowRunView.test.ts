import { describe, expect, it } from 'vitest';
import {
  AgentRunStatus,
  type WorkflowNodeExecutionResponse,
  type WorkflowRunResponse,
} from 'shared/types';
import type { ArenaGroupResponse } from '@/shared/lib/arenaApi';
import {
  buildAgentSessionRows,
  buildWorkflowNodeDebugView,
  buildWorkspaceSessionHref,
  buildArenaWinnerOptions,
  buildWorkflowRunDashboardSummary,
  formatWorkflowDuration,
  getNodeStatusTone,
  getWorkflowRunTaskAttemptLabel,
  getWorkflowRunStatusLabel,
  selectWorkflowRunNode,
} from './workflowRunView';

type NodeExecutionWithProcess = WorkflowNodeExecutionResponse & {
  execution_process_id?: string | null;
};

function withExecutionProcess(
  node: WorkflowNodeExecutionResponse,
  executionProcessId: string | null
): WorkflowNodeExecutionResponse {
  return {
    ...node,
    execution_process_id: executionProcessId,
  } as NodeExecutionWithProcess;
}

const baseRun = {
  id: 'run-1',
  orchestration_run_id: null,
  workflow_id: 'workflow-1',
  attempt_id: null,
  issue_id: 'issue-1',
  workspace_id: null,
  trigger_source: 'manual',
  input_text: 'Implement workflow',
  output_text: null,
  status: 'running',
  started_at: null,
  finished_at: null,
  error_text: null,
  created_at: '2026-05-09T00:00:00Z',
  updated_at: '2026-05-09T00:00:00Z',
  nodes: [
    {
      id: 'node-exec-1',
      run_id: 'run-1',
      task_id: null,
      node_id: 'plan',
      node_type: 'agent',
      iteration: 0n,
      status: 'succeeded',
      input_text: 'input',
      output_text: 'output',
      session_id: null,
      orchestration_node_execution_id: null,
      agent_run_id: null,
      projection_status: null,
      arena_group_id: null,
      tokens_used: null,
      cost_estimate: null,
      started_at: null,
      finished_at: null,
      error_text: null,
      created_at: '2026-05-09T00:00:00Z',
      updated_at: '2026-05-09T00:00:00Z',
    },
    {
      id: 'node-exec-2',
      run_id: 'run-1',
      task_id: null,
      node_id: 'review',
      node_type: 'human_gate',
      iteration: 0n,
      status: 'awaiting_human',
      input_text: 'review this',
      output_text: null,
      session_id: null,
      orchestration_node_execution_id: null,
      agent_run_id: null,
      projection_status: null,
      arena_group_id: null,
      tokens_used: null,
      cost_estimate: null,
      started_at: null,
      finished_at: null,
      error_text: null,
      created_at: '2026-05-09T00:00:00Z',
      updated_at: '2026-05-09T00:00:00Z',
    },
  ],
} satisfies WorkflowRunResponse;

const baseArenaGroup = {
  id: 'arena-1',
  task_id: 'task-arena-1',
  prompt: 'Build three approaches',
  base_branch: 'main',
  mode: 'implementation',
  lifecycle_status: 'open',
  winner_candidate_id: null,
  promoted_at: null,
  closed_at: null,
  created_at: '2026-05-09T00:00:00Z',
  updated_at: '2026-05-09T00:00:00Z',
  events: [],
  workspaces: [
    {
      candidate_id: 'candidate-1',
      workspace_id: 'workspace-1',
      session_id: 'session-1',
      name: 'Attempt Alpha',
      branch: 'vk/issue-wf-arena-1',
      purpose: 'attempt',
      arena_status: 'active',
      executor: 'codex',
      variant: 'gpt-5.4',
      latest_agent_run_status: AgentRunStatus.succeeded,
      has_uncommitted_changes: true,
    },
    {
      candidate_id: 'candidate-2',
      workspace_id: 'workspace-2',
      session_id: null,
      name: null,
      branch: 'vk/issue-wf-synthesis',
      purpose: 'synthesis',
      arena_status: 'active',
      executor: 'codex',
      variant: null,
      latest_agent_run_status: AgentRunStatus.succeeded,
      has_uncommitted_changes: true,
    },
    {
      candidate_id: 'candidate-3',
      workspace_id: 'workspace-3',
      session_id: 'session-3',
      name: null,
      branch: 'vk/issue-wf-arena-3',
      purpose: 'attempt',
      arena_status: 'archived',
      executor: null,
      variant: null,
      latest_agent_run_status: AgentRunStatus.failed,
      has_uncommitted_changes: false,
    },
  ],
} satisfies ArenaGroupResponse;

describe('workflow run view helpers', () => {
  it('formats run statuses for compact UI labels', () => {
    expect(getWorkflowRunStatusLabel('awaiting_human')).toBe(
      'Waiting for human'
    );
    expect(getWorkflowRunStatusLabel('awaiting_arena')).toBe(
      'Waiting for arena'
    );
  });

  it('labels workflow runs as task attempts when attempt id is present', () => {
    const label = getWorkflowRunTaskAttemptLabel({
      id: 'run-12345678',
      attempt_id: 'attempt-abcdef',
    } as WorkflowRunResponse);

    expect(label).toBe('Task attempt attempt-a');
  });

  it('maps node statuses to semantic UI tones', () => {
    expect(getNodeStatusTone('running')).toBe('active');
    expect(getNodeStatusTone('succeeded')).toBe('success');
    expect(getNodeStatusTone('failed')).toBe('danger');
    expect(getNodeStatusTone('pending')).toBe('neutral');
  });

  it('selects the requested node or falls back to the first execution', () => {
    expect(selectWorkflowRunNode(baseRun, 'review')?.node_id).toBe('review');
    expect(selectWorkflowRunNode(baseRun, 'missing')?.node_id).toBe('plan');
    expect(selectWorkflowRunNode(baseRun, null)?.node_id).toBe('plan');
  });

  it('summarizes progress, waiting work, and nullable contribution totals', () => {
    const summary = buildWorkflowRunDashboardSummary({
      ...baseRun,
      runtime_view: {
        run_id: 'run-1',
        status: 'running',
        active_node_count: 0,
        pending_node_count: 0,
        waiting_node_count: 1,
        failed_node_count: 1,
        completed_node_count: 1,
        node_work: [
          {
            node_id: 'plan',
            node_type: 'agent',
            iteration: 0n,
            status: 'succeeded',
            pending_work_count: 0,
            starting_child_count: 0,
            active_execution_id: null,
            active_session_id: null,
            orchestration_node_execution_id: null,
            active_agent_run_id: null,
            projection_status: 'current',
            active_started_at: null,
            active_elapsed_ms: null,
            active_slow: false,
            active_slow_threshold_ms: 300000,
            runtime_health: 'ok',
            can_open_session: false,
            can_retry: false,
            can_approve: false,
            can_reject: false,
            can_select_arena_winner: false,
            can_select_condition_branch: false,
            can_cancel_node: false,
          },
          {
            node_id: 'review',
            node_type: 'human_gate',
            iteration: 0n,
            status: 'awaiting_human',
            pending_work_count: 0,
            starting_child_count: 0,
            active_execution_id: null,
            active_session_id: null,
            orchestration_node_execution_id: null,
            active_agent_run_id: null,
            projection_status: 'current',
            active_started_at: null,
            active_elapsed_ms: null,
            active_slow: false,
            active_slow_threshold_ms: 300000,
            runtime_health: 'ok',
            can_open_session: false,
            can_retry: false,
            can_approve: false,
            can_reject: false,
            can_select_arena_winner: false,
            can_select_condition_branch: false,
            can_cancel_node: false,
          },
          {
            node_id: 'fix',
            node_type: 'agent',
            iteration: 0n,
            status: 'failed',
            pending_work_count: 0,
            starting_child_count: 0,
            active_execution_id: null,
            active_session_id: null,
            orchestration_node_execution_id: null,
            active_agent_run_id: null,
            projection_status: 'current',
            active_started_at: null,
            active_elapsed_ms: null,
            active_slow: false,
            active_slow_threshold_ms: 300000,
            runtime_health: 'ok',
            can_open_session: false,
            can_retry: false,
            can_approve: false,
            can_reject: false,
            can_select_arena_winner: false,
            can_select_condition_branch: false,
            can_cancel_node: false,
          },
        ],
      },
      nodes: [
        {
          ...baseRun.nodes[0],
          tokens_used: 1200n,
          cost_estimate: 0.42,
        },
        baseRun.nodes[1],
        {
          ...baseRun.nodes[0],
          id: 'node-exec-3',
          node_id: 'fix',
          node_type: 'agent',
          status: 'failed',
          tokens_used: null,
          cost_estimate: null,
        },
      ],
    });

    expect(summary.totalSteps).toBe(3);
    expect(summary.completedSteps).toBe(1);
    expect(summary.skippedSteps).toBe(0);
    expect(summary.waitingSteps).toBe(1);
    expect(summary.failedSteps).toBe(1);
    expect(summary.progressPercent).toBe(33);
    expect(summary.totalTokens).toBe(1200);
    expect(summary.totalCostEstimate).toBe(0.42);
  });

  it('does not count skipped work as succeeded progress', () => {
    const summary = buildWorkflowRunDashboardSummary({
      ...baseRun,
      status: 'canceled',
      nodes: [
        {
          ...baseRun.nodes[0],
          status: 'succeeded',
        },
        {
          ...baseRun.nodes[1],
          status: 'skipped',
        },
        {
          ...baseRun.nodes[0],
          id: 'node-exec-3',
          node_id: 'failed',
          status: 'failed',
        },
      ],
    });

    expect(summary.totalSteps).toBe(3);
    expect(summary.completedSteps).toBe(1);
    expect(summary.skippedSteps).toBe(1);
    expect(summary.failedSteps).toBe(1);
    expect(summary.progressPercent).toBe(33);
  });

  it('formats elapsed durations from timestamps', () => {
    expect(
      formatWorkflowDuration('2026-05-09T00:00:00Z', '2026-05-09T00:02:05Z')
    ).toBe('2m 5s');
    expect(formatWorkflowDuration(null, null)).toBe('Not started');
  });

  it('builds winner options from explicit arena candidate identities', () => {
    const options = buildArenaWinnerOptions(baseArenaGroup);

    expect(options.map((option) => option.workspaceId)).toEqual([
      'workspace-1',
      'workspace-2',
      'workspace-3',
    ]);
    expect(options.map((option) => option.candidateId)).toEqual([
      'candidate-1',
      'candidate-2',
      'candidate-3',
    ]);
    expect(options[0]).toMatchObject({
      label: 'Attempt Alpha',
      executorLabel: 'codex / gpt-5.4',
      executionStatusLabel: 'succeeded',
      isSelectable: true,
      isPromoted: false,
    });
    expect(options[2]).toMatchObject({
      label: 'Attempt 3',
      executorLabel: 'Unknown executor',
      executionStatusLabel: 'failed',
      isSelectable: false,
      isPromoted: false,
    });
  });

  it('marks winner options unavailable after promotion or while running', () => {
    const options = buildArenaWinnerOptions({
      ...baseArenaGroup,
      winner_candidate_id: 'candidate-1',
      workspaces: [
        {
          ...baseArenaGroup.workspaces[0],
          arena_status: 'promoted',
        },
        {
          ...baseArenaGroup.workspaces[2],
          workspace_id: 'workspace-4',
          arena_status: 'active',
          latest_agent_run_status: AgentRunStatus.running,
        },
      ],
    });

    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({
      workspaceId: 'workspace-1',
      isSelectable: false,
      isPromoted: true,
    });
    expect(options[1]).toMatchObject({
      workspaceId: 'workspace-4',
      isSelectable: false,
      isPromoted: false,
      executionStatusLabel: 'running',
    });
  });

  it('requires an attempt to complete before it can be selected', () => {
    const options = buildArenaWinnerOptions({
      ...baseArenaGroup,
      workspaces: [
        {
          ...baseArenaGroup.workspaces[0],
          latest_agent_run_status: null,
        },
      ],
    });

    expect(options[0]).toMatchObject({
      executionStatusLabel: 'not started',
      isSelectable: false,
    });
  });

  it('builds an Agent Sessions list for the selected node only', () => {
    const rows = buildAgentSessionRows(
      {
        ...baseRun,
        nodes: [
          withExecutionProcess(
            {
              ...baseRun.nodes[0],
              id: 'node-exec-plan',
              node_id: 'plan',
              node_type: 'agent',
              session_id: 'session-plan',
              output_text: 'Plan output',
              started_at: '2026-05-09T00:00:00Z',
              finished_at: '2026-05-09T00:02:05Z',
            },
            'process-plan'
          ),
          withExecutionProcess(
            {
              ...baseRun.nodes[0],
              id: 'node-exec-implement',
              node_id: 'implement',
              node_type: 'agent',
              session_id: 'session-implement',
              output_text: 'Implementation output',
            },
            'process-implement'
          ),
          baseRun.nodes[1],
        ],
      },
      'plan'
    );

    expect(rows).toEqual([
      {
        runId: 'run-1',
        runLabel: 'run-1',
        nodeId: 'plan',
        sessionId: 'session-plan',
        executionProcessId: 'process-plan',
        statusLabel: 'succeeded',
        startedLabel: '2026-05-09T00:00:00Z',
        durationLabel: '2m 5s',
        outputPreview: 'Plan output',
      },
    ]);
  });

  it('builds workspace links that select a specific Session', () => {
    expect(
      buildWorkspaceSessionHref(
        '/projects/project-1/issues/issue-1/workspaces/workspace-1',
        'session 1'
      )
    ).toBe(
      '/projects/project-1/issues/issue-1/workspaces/workspace-1?session_id=session%201'
    );

    expect(
      buildWorkspaceSessionHref(
        '/projects/project-1/issues/issue-1/workspaces/workspace-1?panel=chat#bottom',
        'session-2'
      )
    ).toBe(
      '/projects/project-1/issues/issue-1/workspaces/workspace-1?panel=chat&session_id=session-2#bottom'
    );
  });

  it('builds debug data for a selected run node', () => {
    const debug = buildWorkflowNodeDebugView({
      run: {
        ...baseRun,
        input_text: 'Build feature',
        nodes: [
          {
            ...baseRun.nodes[0],
            node_id: 'plan',
            output_text: 'plan result',
          },
          withExecutionProcess(
            {
              ...baseRun.nodes[0],
              id: 'node-exec-review',
              node_id: 'review',
              input_text: 'Review rendered prompt',
              output_text: 'review result',
              session_id: 'session-review',
            },
            'process-review'
          ),
        ],
      },
      graph: {
        version: 2,
        nodes: [
          {
            id: 'plan',
            type: 'agent',
            data: { prompt_template: 'Plan {{input}}' },
          },
          {
            id: 'review',
            type: 'agent',
            data: { prompt_template: 'Review {{upstream}}' },
          },
        ],
        edges: [
          {
            id: 'plan-review',
            source: 'plan',
            source_handle: 'output-right',
            target: 'review',
            target_handle: 'input-left',
            type: 'default',
          },
        ],
      },
      nodeId: 'review',
    });

    expect(debug).toMatchObject({
      nodeId: 'review',
      promptTemplate: 'Review {{upstream}}',
      renderedPrompt: 'Review rendered prompt',
      rawInput: 'Build feature',
      outputText: 'review result',
      sessionId: 'session-review',
      executionProcessId: 'process-review',
      upstreamOutputs: [{ nodeId: 'plan', outputText: 'plan result' }],
    });
  });
});
