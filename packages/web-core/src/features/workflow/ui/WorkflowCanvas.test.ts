import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_CANVAS_DELETE_KEYS,
  WORKFLOW_CANVAS_EDGE_TYPE,
  WORKFLOW_CANVAS_MINIMAP_BACKGROUND,
  WORKFLOW_CANVAS_SNAP_GRID,
  filterReadOnlyEdgeChanges,
  filterReadOnlyNodeChanges,
  hasGraphAffectingEdgeChanges,
  hasGraphAffectingNodeChanges,
} from './WorkflowCanvas';

describe('workflow canvas interaction settings', () => {
  it('uses benchmark-backed snap grid spacing', () => {
    expect(WORKFLOW_CANVAS_SNAP_GRID).toEqual([15, 15]);
  });

  it('allows common delete keys to remove selected graph elements', () => {
    expect(WORKFLOW_CANVAS_DELETE_KEYS).toEqual(['Backspace', 'Delete']);
  });

  it('uses a custom semantic edge renderer', () => {
    expect(WORKFLOW_CANVAS_EDGE_TYPE).toBe('workflow');
  });

  it('keeps selection changes in read-only mode while blocking graph edits', () => {
    expect(
      filterReadOnlyNodeChanges([
        { type: 'select', id: 'agent', selected: true },
        { type: 'position', id: 'agent', position: { x: 20, y: 20 } },
        { type: 'remove', id: 'agent' },
      ])
    ).toEqual([
      { type: 'select', id: 'agent', selected: true },
      { type: 'position', id: 'agent', position: { x: 20, y: 20 } },
    ]);

    expect(
      filterReadOnlyEdgeChanges([
        { type: 'select', id: 'agent-end', selected: true },
        { type: 'remove', id: 'agent-end' },
      ])
    ).toEqual([{ type: 'select', id: 'agent-end', selected: true }]);
  });

  it('only persists graph-affecting canvas changes', () => {
    expect(
      hasGraphAffectingNodeChanges([{ type: 'select' }, { type: 'dimensions' }])
    ).toBe(false);
    expect(hasGraphAffectingNodeChanges([{ type: 'position' }])).toBe(true);

    expect(hasGraphAffectingEdgeChanges([{ type: 'select' }])).toBe(false);
    expect(hasGraphAffectingEdgeChanges([{ type: 'remove' }])).toBe(true);
  });

  it('uses a stable non-white minimap background token', () => {
    expect(WORKFLOW_CANVAS_MINIMAP_BACKGROUND).toBe(
      'hsl(var(--bg-panel, 0 0% 89%))'
    );
  });
});
