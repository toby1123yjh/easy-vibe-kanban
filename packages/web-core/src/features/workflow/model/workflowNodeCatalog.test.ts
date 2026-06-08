import { describe, expect, it } from 'vitest';
import {
  getWorkflowNodeCatalogSections,
  isWorkflowNodeAuthorable,
} from './workflowNodeCatalog';

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
    ]);
    expect(sections.flatMap((section) => section.types)).not.toContain('start');
    expect(sections.flatMap((section) => section.types)).not.toContain('end');
    expect(sections.flatMap((section) => section.types)).not.toContain('arena');
    expect(sections.flatMap((section) => section.types)).not.toContain(
      'transform'
    );
  });

  it('keeps structural and hidden nodes out of manual authoring', () => {
    expect(isWorkflowNodeAuthorable('agent')).toBe(true);
    expect(isWorkflowNodeAuthorable('condition')).toBe(true);
    expect(isWorkflowNodeAuthorable('human_gate')).toBe(true);
    expect(isWorkflowNodeAuthorable('start')).toBe(false);
    expect(isWorkflowNodeAuthorable('end')).toBe(false);
    expect(isWorkflowNodeAuthorable('arena')).toBe(false);
  });
});
