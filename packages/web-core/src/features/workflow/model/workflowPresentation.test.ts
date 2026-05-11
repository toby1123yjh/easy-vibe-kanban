import { describe, expect, it } from 'vitest';
import {
  getWorkflowEdgeVisual,
  getWorkflowNodeMetadata,
  getWorkflowEdgeKindOptions,
  getWorkflowEdgeLabel,
  getWorkflowNodeKindLabel,
  getWorkflowNodeRouteHints,
  getWorkflowNodeSummary,
  getWorkflowNodeVisual,
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

  it('returns ordered edge kind options for the edge inspector', () => {
    expect(getWorkflowEdgeKindOptions()).toEqual([
      {
        value: 'default',
        label: 'Default',
        description: 'Continue to the next node.',
      },
      {
        value: 'condition_branch',
        label: 'Condition',
        description: 'Route through a conditional branch.',
      },
      {
        value: 'approval',
        label: 'Approve',
        description: 'Continue after a human approval.',
      },
      {
        value: 'rejection',
        label: 'Reject',
        description: 'Route after a human rejection.',
      },
      {
        value: 'arena_winner',
        label: 'Winner',
        description: 'Promote the winning arena attempt.',
      },
    ]);
  });

  it('returns stable visual tokens for workflow node kinds', () => {
    expect(getWorkflowNodeVisual('condition')).toMatchObject({
      accentClass: expect.stringContaining('amber'),
      iconClass: expect.stringContaining('amber'),
    });
    expect(getWorkflowNodeVisual('human_gate')).toMatchObject({
      accentClass: expect.stringContaining('violet'),
      iconClass: expect.stringContaining('violet'),
    });
  });

  it('returns compact metadata chips for workflow nodes', () => {
    expect(
      getWorkflowNodeMetadata('agent', {
        role_template_id: 'reviewer',
        output_capture: 'diff_summary',
      })
    ).toEqual([
      { label: 'Role', value: 'reviewer' },
      { label: 'Capture', value: 'diff summary' },
    ]);

    expect(
      getWorkflowNodeMetadata('arena', {
        attempts: [{ id: 'a' }, { id: 'b' }],
        promote_strategy: 'manual',
      })
    ).toEqual([
      { label: 'Attempts', value: '2' },
      { label: 'Promote', value: 'manual' },
    ]);
  });

  it('returns route hints for branching node kinds', () => {
    expect(
      getWorkflowNodeRouteHints('condition', {
        branches: [{ name: 'true' }, { name: 'fallback' }],
      })
    ).toEqual([
      { label: 'true', tone: 'success' },
      { label: 'fallback', tone: 'warning' },
    ]);
    expect(getWorkflowNodeRouteHints('human_gate', {})).toEqual([
      { label: 'Approve', tone: 'success' },
      { label: 'Reject', tone: 'danger' },
    ]);
    expect(getWorkflowNodeRouteHints('arena', {})).toEqual([
      { label: 'Winner', tone: 'brand' },
    ]);
  });

  it('returns visual tokens for semantic edge kinds', () => {
    expect(getWorkflowEdgeVisual('approval')).toMatchObject({
      label: 'Approve',
      pathClass: expect.stringContaining('emerald'),
      chipClass: expect.stringContaining('emerald'),
    });
    expect(getWorkflowEdgeVisual('rejection')).toMatchObject({
      label: 'Reject',
      pathClass: expect.stringContaining('rose'),
      chipClass: expect.stringContaining('rose'),
    });
  });
});
