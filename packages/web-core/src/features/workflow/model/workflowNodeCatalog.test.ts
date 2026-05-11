import { describe, expect, it } from 'vitest';
import { getWorkflowNodeCatalogSections } from './workflowNodeCatalog';

describe('workflow node catalog sections', () => {
  it('groups node catalog entries into authoring sections', () => {
    expect(
      getWorkflowNodeCatalogSections().map((section) => ({
        label: section.label,
        types: section.entries.map((entry) => entry.type),
      }))
    ).toEqual([
      { label: 'Entry', types: ['start', 'end'] },
      { label: 'AI', types: ['agent', 'arena'] },
      { label: 'Control', types: ['condition', 'human_gate', 'transform'] },
    ]);
  });
});
