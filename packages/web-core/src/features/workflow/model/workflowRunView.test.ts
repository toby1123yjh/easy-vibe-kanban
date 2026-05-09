import { describe, expect, it } from 'vitest';
import type { WorkflowRunResponse } from 'shared/types';
import {
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
});
