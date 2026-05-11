import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_CANVAS_DELETE_KEYS,
  WORKFLOW_CANVAS_EDGE_TYPE,
  WORKFLOW_CANVAS_SNAP_GRID,
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
});
