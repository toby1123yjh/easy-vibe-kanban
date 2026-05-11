import { describe, expect, it } from 'vitest';
import {
  getWorkflowEdgeLabel,
  getWorkflowNodeKindLabel,
  getWorkflowNodeSummary,
} from './workflowPresentation';

describe('workflow presentation helpers', () => {
  it('returns human-readable node kind labels', () => {
    expect(getWorkflowNodeKindLabel('human_gate')).toBe('Human Gate');
    expect(getWorkflowNodeKindLabel('arena')).toBe('Arena');
  });

  it('returns compact node summaries for canvas nodes', () => {
    expect(
      getWorkflowNodeSummary('agent', { role_template_id: 'reviewer' })
    ).toBe('Role: reviewer');
    expect(
      getWorkflowNodeSummary('condition', {
        branches: [{ name: 'Matched' }, { name: 'Fallback' }],
      })
    ).toBe('Branches: 2');
    expect(getWorkflowNodeSummary('human_gate', {})).toBe('Waits for approval');
  });

  it('returns semantic labels for non-default edges only', () => {
    expect(getWorkflowEdgeLabel('default')).toBeUndefined();
    expect(getWorkflowEdgeLabel('condition_branch')).toBe('Condition');
    expect(getWorkflowEdgeLabel('approval')).toBe('Approve');
    expect(getWorkflowEdgeLabel('rejection')).toBe('Reject');
    expect(getWorkflowEdgeLabel('arena_winner')).toBe('Winner');
  });
});
