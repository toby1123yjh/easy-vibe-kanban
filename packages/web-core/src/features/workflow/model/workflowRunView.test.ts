import { describe, expect, it } from 'vitest';
import type { WorkflowRunResponse } from 'shared/types';
import {
  buildWorkflowRunDashboardSummary,
  formatWorkflowDuration,
  getNodeStatusTone,
  getWorkflowRunStatusLabel,
  selectWorkflowRunNode,
} from './workflowRunView';

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
});
