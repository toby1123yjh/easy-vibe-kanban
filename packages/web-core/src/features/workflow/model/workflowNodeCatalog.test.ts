import { describe, expect, it } from 'vitest';
import { getWorkflowNodeCatalogSections } from './workflowNodeCatalog';

describe('workflow node catalog sections', () => {
  it('groups node catalog entries into authoring sections', () => {
    const sections = getWorkflowNodeCatalogSections().map((section) => ({
      id: section.id,
      label: section.label,
      labelKey: section.labelKey,
      types: section.entries.map((entry) => entry.type),
    }));

    expect(sections).toEqual([
      {
        id: 'execution',
        label: 'Execution',
        labelKey: 'workflow.editor.sections.execution',
        types: ['agent'],
      },
      {
        id: 'control',
        label: 'Control',
        labelKey: 'workflow.editor.sections.control',
        types: ['condition', 'human_gate'],
      },
      {
        id: 'structure',
        label: 'Structure',
        labelKey: 'workflow.editor.sections.structure',
        types: ['start', 'end'],
      },
    ]);
    expect(sections.flatMap((section) => section.types)).not.toContain('arena');
    expect(sections.flatMap((section) => section.types)).not.toContain(
      'transform'
    );
  });
});
