import { describe, expect, it } from 'vitest';
import type {
  WorkflowNodeExecutionResponse,
  WorkflowRunResponse,
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
  workflow_id: 'workflow-1',
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
      node_id: 'plan',
      node_type: 'agent',
      iteration: 0n,
      status: 'succeeded',
      input_text: 'input',
      output_text: 'output',
      session_id: null,
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
      node_id: 'review',
      node_type: 'human_gate',
      iteration: 0n,
      status: 'awaiting_human',
      input_text: 'review this',
      output_text: null,
      session_id: null,
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
  issue_id: 'issue-1',
  project_id: 'project-1',
  prompt: 'Build three approaches',
  base_branch: 'main',
  mode: 'implementation',
  lifecycle_status: 'open',
  promoted_workspace_id: null,
  implementation_workspace_id: null,
  promoted_at: null,
  closed_at: null,
  created_at: '2026-05-09T00:00:00Z',
  updated_at: '2026-05-09T00:00:00Z',
  events: [],
  workspaces: [
    {
      workspace_id: 'workspace-1',
      session_id: 'session-1',
      name: 'Attempt Alpha',
      branch: 'vk/issue-wf-arena-1',
      purpose: 'attempt',
      arena_status: 'active',
      executor: 'codex',
      variant: 'gpt-5.4',
      latest_execution_status: 'completed',
      has_uncommitted_changes: true,
    },
    {
      workspace_id: 'workspace-2',
      session_id: null,
      name: null,
      branch: 'vk/issue-wf-synthesis',
      purpose: 'synthesis',
      arena_status: 'active',
      executor: 'codex',
      variant: null,
      latest_execution_status: 'completed',
      has_uncommitted_changes: true,
    },
    {
      workspace_id: 'workspace-3',
      session_id: 'session-3',
      name: null,
      branch: 'vk/issue-wf-arena-3',
      purpose: 'attempt',
      arena_status: 'archived',
      executor: null,
      variant: null,
      latest_execution_status: 'failed',
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
    expect(summary.waitingSteps).toBe(1);
    expect(summary.failedSteps).toBe(1);
    expect(summary.progressPercent).toBe(33);
    expect(summary.totalTokens).toBe(1200);
    expect(summary.totalCostEstimate).toBe(0.42);
  });

  it('formats elapsed durations from timestamps', () => {
    expect(
      formatWorkflowDuration('2026-05-09T00:00:00Z', '2026-05-09T00:02:05Z')
    ).toBe('2m 5s');
    expect(formatWorkflowDuration(null, null)).toBe('Not started');
  });

  it('builds winner options from arena attempt workspaces only', () => {
    const options = buildArenaWinnerOptions(baseArenaGroup);

    expect(options.map((option) => option.workspaceId)).toEqual([
      'workspace-1',
      'workspace-3',
    ]);
    expect(options[0]).toMatchObject({
      label: 'Attempt Alpha',
      executorLabel: 'codex / gpt-5.4',
      executionStatusLabel: 'completed',
      isSelectable: true,
      isPromoted: false,
    });
    expect(options[1]).toMatchObject({
      label: 'Attempt 2',
      executorLabel: 'Unknown executor',
      executionStatusLabel: 'failed',
      isSelectable: false,
      isPromoted: false,
    });
  });

  it('marks winner options unavailable after promotion or while running', () => {
    const options = buildArenaWinnerOptions({
      ...baseArenaGroup,
      promoted_workspace_id: 'workspace-1',
      workspaces: [
        {
          ...baseArenaGroup.workspaces[0],
          arena_status: 'promoted',
        },
        {
          ...baseArenaGroup.workspaces[2],
          workspace_id: 'workspace-4',
          arena_status: 'active',
          latest_execution_status: 'running',
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
          latest_execution_status: null,
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
