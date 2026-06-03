import { describe, expect, it } from 'vitest';
import { shouldShowWorkflowTemplate } from './workflowTemplateVisibility';

describe('workflow template visibility', () => {
  it('hides system templates that contain Arena nodes', () => {
    expect(
      shouldShowWorkflowTemplate({
        source: 'system',
        graph_json: JSON.stringify({
          version: 2,
          nodes: [{ id: 'arena', type: 'arena', data: {} }],
          edges: [],
        }),
      })
    ).toBe(false);
  });

  it('keeps project templates visible even when they already contain Arena nodes', () => {
    expect(
      shouldShowWorkflowTemplate({
        source: 'project',
        graph_json: JSON.stringify({
          version: 2,
          nodes: [{ id: 'arena', type: 'arena', data: {} }],
          edges: [],
        }),
      })
    ).toBe(true);
  });
});
