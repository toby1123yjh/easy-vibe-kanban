import { describe, expect, it } from 'vitest';
import { ConnectionMode, MarkerType } from '@xyflow/react';
import {
  WORKFLOW_CANVAS_CONNECTION_MODE,
  WORKFLOW_CANVAS_CONNECTION_LINE_TYPE,
  WORKFLOW_CANVAS_DEFAULT_EDGE_OPTIONS,
  WORKFLOW_CANVAS_DELETE_KEYS,
  WORKFLOW_CANVAS_EDGE_ACTIONS,
  WORKFLOW_CANVAS_EDGE_INTERACTION_WIDTH,
  WORKFLOW_CANVAS_EDGE_TYPE,
  WORKFLOW_CANVAS_NODE_ACTIONS,
  WORKFLOW_CANVAS_RECONNECT_RADIUS,
  WORKFLOW_CANVAS_SNAP_GRID,
  filterReadOnlyEdgeChanges,
  filterReadOnlyNodeChanges,
  getWorkflowCanvasConnectionIssue,
  getWorkflowSelfLoopPath,
  hasGraphAffectingEdgeChanges,
  hasGraphAffectingNodeChanges,
  isWorkflowCanvasConnectionAllowed,
} from './WorkflowCanvas';
import {
  WORKFLOW_CANVAS_CLASS_NAMES,
  WORKFLOW_CANVAS_EDGE_CLASSES,
  WORKFLOW_CANVAS_TOKEN_GROUPS,
} from './workflowCanvasTokens';

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

  it('renders directional workflow edges without persisting marker metadata', () => {
    expect(WORKFLOW_CANVAS_DEFAULT_EDGE_OPTIONS.markerEnd).toEqual({
      type: MarkerType.ArrowClosed,
      color: 'context-stroke',
      width: 20,
      height: 20,
      markerUnits: 'userSpaceOnUse',
      strokeWidth: 2.2,
    });
    expect(WORKFLOW_CANVAS_DEFAULT_EDGE_OPTIONS.interactionWidth).toBe(
      WORKFLOW_CANVAS_EDGE_INTERACTION_WIDTH
    );
    expect(WORKFLOW_CANVAS_DEFAULT_EDGE_OPTIONS).not.toHaveProperty(
      'reconnectable'
    );
  });

  it('keeps visual token groups explicit for canvas, nodes, edges, panels, and motion', () => {
    expect(WORKFLOW_CANVAS_TOKEN_GROUPS).toEqual([
      'canvas',
      'node',
      'edge',
      'panel',
      'motion',
    ]);
    expect(WORKFLOW_CANVAS_CLASS_NAMES.reactFlow).toContain(
      'workflow-canvas-product'
    );
    expect(WORKFLOW_CANVAS_CLASS_NAMES.controls).toContain(
      '--workflow-canvas-control-bg'
    );
    expect(WORKFLOW_CANVAS_CLASS_NAMES.sidePanel).toContain(
      '--workflow-panel-bg'
    );
    expect(WORKFLOW_CANVAS_EDGE_CLASSES.actionButton).toContain(
      'workflow-edge-action-button'
    );
    expect(WORKFLOW_CANVAS_EDGE_CLASSES.actionButton).toContain(
      'rounded-[6px]'
    );
    expect(WORKFLOW_CANVAS_EDGE_CLASSES.actionButton).not.toContain(
      'rounded-full'
    );
  });

  it('uses a smooth step connection preview while dragging wires', () => {
    expect(WORKFLOW_CANVAS_CONNECTION_LINE_TYPE).toBe('smoothstep');
  });

  it('uses loose connection mode so one visible port can start and receive wires', () => {
    expect(WORKFLOW_CANVAS_CONNECTION_MODE).toBe(ConnectionMode.Loose);
  });

  it('keeps reconnect handles easy to grab without thickening the visible line', () => {
    expect(WORKFLOW_CANVAS_EDGE_INTERACTION_WIDTH).toBe(32);
    expect(WORKFLOW_CANVAS_RECONNECT_RADIUS).toBe(16);
  });

  it('keeps object-level node and edge actions discoverable near the object', () => {
    expect(WORKFLOW_CANVAS_NODE_ACTIONS).toEqual([
      'open-session',
      'edit',
      'run-step',
      'duplicate',
      'delete',
    ]);
    expect(WORKFLOW_CANVAS_EDGE_ACTIONS).toEqual([
      'insert-agent-step',
      'reconnect-source',
      'reconnect-target',
      'delete-edge',
    ]);
  });

  it('rejects workflow connections that cannot be executed', () => {
    const nodeTypes = new Map([
      ['start', 'start'],
      ['agent', 'agent'],
      ['end', 'end'],
    ]);

    expect(
      isWorkflowCanvasConnectionAllowed(
        { source: 'start', target: 'agent' },
        nodeTypes
      )
    ).toBe(true);
    expect(
      getWorkflowCanvasConnectionIssue(
        { source: 'agent', target: 'agent' },
        nodeTypes
      )
    ).toBe('self_edge');
    expect(
      getWorkflowCanvasConnectionIssue(
        { source: 'end', target: 'agent' },
        nodeTypes
      )
    ).toBe('end_source');
    expect(
      getWorkflowCanvasConnectionIssue(
        { source: 'agent', target: 'start' },
        nodeTypes
      )
    ).toBe('start_target');
  });

  it('renders self edges as an outer loop instead of a collapsed line', () => {
    const [path, labelX, labelY] = getWorkflowSelfLoopPath({
      sourceX: 100,
      sourceY: 120,
      targetX: 100,
      targetY: 120,
    });

    expect(path).toBe('M 100,120 C 196,44 196,196 100,120');
    expect(labelX).toBe(196);
    expect(labelY).toBe(120);
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
});
