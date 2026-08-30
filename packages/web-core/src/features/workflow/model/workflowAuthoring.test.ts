import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_SEMANTIC_HANDLE_IDS,
  applyWorkflowTransform,
  acknowledgeWorkflowSave,
  canonicalizeWorkflowAuthoringGraph,
  commitWorkflowAuthoringGraph,
  createWorkflowAuthoringState,
  createWorkflowSaveSnapshot,
  dispatchWorkflowAuthoringCommand,
  getWorkflowNodeSourceHandles,
  redoWorkflowAuthoring,
  undoWorkflowAuthoring,
  validateWorkflowAuthoringGraph,
  validateWorkflowConnection,
  type WorkflowIdFactory,
} from './workflowAuthoring';
import {
  WORKFLOW_GRAPH_VERSION,
  createWorkflowEdge,
  createWorkflowNode,
  type WorkflowGraph,
} from './workflowGraph';

const ids = (...values: string[]): WorkflowIdFactory => {
  let index = 0;
  return { next: () => values[index++] ?? `generated-${index}` };
};

function graphWith(
  ...nodeTypes: Parameters<typeof createWorkflowNode>[0][]
): WorkflowGraph {
  return {
    version: WORKFLOW_GRAPH_VERSION,
    nodes: nodeTypes.map((type, index) =>
      createWorkflowNode(type, {
        id: `${type}-${index}`,
        position: { x: index * 300, y: 120 },
      })
    ),
    edges: [],
  };
}

describe('workflow authoring model', () => {
  it('projects semantic handles from the source Node type', () => {
    const condition = createWorkflowNode('condition', {
      id: 'condition',
      data: {
        branches: [
          { id: 'branch-yes', condition: 'Approved' },
          { id: 'branch-no', condition: 'Needs work' },
        ],
      },
    });

    expect(getWorkflowNodeSourceHandles(condition)).toEqual([
      {
        id: 'branch:branch-yes',
        kind: 'condition_branch',
        label: 'Approved',
        branchId: 'branch-yes',
      },
      {
        id: 'branch:branch-no',
        kind: 'condition_branch',
        label: 'Needs work',
        branchId: 'branch-no',
      },
    ]);
    expect(
      getWorkflowNodeSourceHandles(createWorkflowNode('human_gate')).map(
        (handle) => handle.id
      )
    ).toEqual(['approve', 'reject']);
    expect(
      getWorkflowNodeSourceHandles(createWorkflowNode('arena')).map(
        (handle) => handle.id
      )
    ).toEqual(['winner']);
    expect(getWorkflowNodeSourceHandles(createWorkflowNode('end'))).toEqual([]);
  });

  it('migrates positional handles to semantic routes and strips Skills', () => {
    const canonical = canonicalizeWorkflowAuthoringGraph({
      version: 2,
      nodes: [
        createWorkflowNode('human_gate', { id: 'gate' }),
        createWorkflowNode('agent', {
          id: 'agent',
          data: {
            selected_skills: [{ name: 'legacy', path: '/legacy' }],
          },
        }),
      ],
      edges: [
        createWorkflowEdge({
          id: 'rejected',
          source: 'gate',
          source_handle: 'port-bottom',
          target: 'agent',
          target_handle: 'port-left',
          type: 'rejection',
        }),
      ],
    });

    expect(canonical.edges[0]).toMatchObject({
      source_handle: WORKFLOW_SEMANTIC_HANDLE_IDS.reject,
      target_handle: WORKFLOW_SEMANTIC_HANDLE_IDS.input,
      type: 'rejection',
    });
    expect(canonical.nodes[1].data.selected_skills).toBeUndefined();
  });

  it('rejects illegal connections atomically without consuming a revision', () => {
    const state = createWorkflowAuthoringState(
      graphWith('start', 'agent', 'end')
    );
    const result = dispatchWorkflowAuthoringCommand(state, {
      type: 'connect',
      source: 'agent-1',
      sourceHandle: 'default',
      target: 'start-0',
    });

    expect(result.issue?.code).toBe('start-target');
    expect(result.state).toBe(state);
    expect(result.state.clientRevision).toBe(0);
    expect(result.state.graph.edges).toEqual([]);
  });

  it('creates a semantic edge and keeps its stable identity through undo/redo', () => {
    const state = createWorkflowAuthoringState(
      graphWith('start', 'agent', 'end')
    );
    const connected = dispatchWorkflowAuthoringCommand(
      state,
      {
        type: 'connect',
        source: 'start-0',
        sourceHandle: 'default',
        target: 'agent-1',
      },
      ids('edge-start-agent')
    ).state;

    expect(connected.graph.edges[0]).toEqual({
      id: 'edge-start-agent',
      source: 'start-0',
      source_handle: 'default',
      target: 'agent-1',
      target_handle: 'input',
      type: 'default',
    });
    const undone = undoWorkflowAuthoring(connected);
    expect(undone.graph.edges).toEqual([]);
    const redone = redoWorkflowAuthoring(undone);
    expect(redone.graph.edges[0].id).toBe('edge-start-agent');
    expect(redone.clientRevision).toBe(3);
  });

  it('creates and connects a Node as one atomic command', () => {
    const state = createWorkflowAuthoringState(graphWith('start', 'end'));
    const created = dispatchWorkflowAuthoringCommand(
      state,
      {
        type: 'create-connected-node',
        source: 'start-0',
        sourceHandle: 'default',
        nodeType: 'transform',
        position: { x: 300, y: 120 },
        data: { mode: 'template', template: '{{input}}' },
      },
      ids('transform-created', 'edge-created')
    ).state;

    expect(created.graph.nodes.map((node) => node.id)).toContain(
      'transform-created'
    );
    expect(created.graph.edges).toEqual([
      expect.objectContaining({
        id: 'edge-created',
        source: 'start-0',
        target: 'transform-created',
      }),
    ]);
    expect(created.undoStack).toHaveLength(1);
    const undone = undoWorkflowAuthoring(created);
    expect(undone.graph.nodes.map((node) => node.id)).not.toContain(
      'transform-created'
    );
    expect(undone.graph.edges).toEqual([]);
  });

  it('keeps a Condition branch single-target while other handles can fan out', () => {
    const graph = graphWith('condition', 'agent', 'agent');
    graph.nodes[0].data.branches = [{ id: 'only', condition: 'Approved' }];
    graph.edges = [
      createWorkflowEdge({
        id: 'first',
        source: 'condition-0',
        source_handle: 'branch:only',
        target: 'agent-1',
        type: 'condition_branch',
      }),
    ];

    expect(
      validateWorkflowConnection(graph, {
        source: 'condition-0',
        sourceHandle: 'branch:only',
        target: 'agent-2',
      })?.code
    ).toBe('occupied-source-handle');

    graph.edges.push(
      createWorkflowEdge({
        id: 'second',
        source: 'condition-0',
        source_handle: 'branch:only',
        target: 'agent-2',
        type: 'condition_branch',
      })
    );
    expect(validateWorkflowAuthoringGraph(graph)).toContainEqual({
      code: 'occupied-source-handle',
      message: 'This Condition branch is already connected.',
      nodeId: 'condition-0',
      edgeId: 'second',
      field: 'branches',
    });

    const fanOut = graphWith('agent', 'transform', 'transform');
    fanOut.edges = [
      createWorkflowEdge({
        id: 'first',
        source: 'agent-0',
        source_handle: 'default',
        target: 'transform-1',
      }),
    ];
    expect(
      validateWorkflowConnection(fanOut, {
        source: 'agent-0',
        sourceHandle: 'default',
        target: 'transform-2',
      })
    ).toBeNull();
    expect(
      validateWorkflowAuthoringGraph({
        ...fanOut,
        edges: [
          ...fanOut.edges,
          createWorkflowEdge({
            id: 'second',
            source: 'agent-0',
            source_handle: 'default',
            target: 'transform-2',
          }),
        ],
      }).some((issue) => issue.code === 'occupied-source-handle')
    ).toBe(false);
  });

  it('deletes a Node and its edges in one scoped reversible command', () => {
    const graph = graphWith('start', 'agent', 'end');
    graph.edges = [
      createWorkflowEdge({ id: 'in', source: 'start-0', target: 'agent-1' }),
      createWorkflowEdge({ id: 'out', source: 'agent-1', target: 'end-2' }),
    ];
    const state = createWorkflowAuthoringState(graph);
    const removed = dispatchWorkflowAuthoringCommand(state, {
      type: 'delete-nodes',
      nodeIds: ['agent-1'],
    }).state;

    expect(removed.graph.nodes.map((node) => node.id)).toEqual([
      'start-0',
      'end-2',
    ]);
    expect(removed.graph.edges).toEqual([]);
    expect(removed.undoStack[0].inverse.nodes).toHaveLength(1);
    expect(removed.undoStack[0].inverse.edges).toHaveLength(2);

    const restored = undoWorkflowAuthoring(removed);
    expect(restored.graph.nodes.map((node) => node.id)).toEqual([
      'start-0',
      'agent-1',
      'end-2',
    ]);
    expect(restored.graph.edges.map((edge) => edge.id)).toEqual(['in', 'out']);
  });

  it('removes deleted Condition branch edges in the same reversible command', () => {
    const graph = graphWith('condition', 'agent', 'agent');
    graph.nodes[0].data.branches = [
      { id: 'branch-keep', condition: 'Keep' },
      { id: 'branch-remove', condition: 'Remove' },
    ];
    graph.edges = [
      createWorkflowEdge({
        id: 'edge-keep',
        source: 'condition-0',
        source_handle: 'branch:branch-keep',
        target: 'agent-1',
        type: 'condition_branch',
      }),
      createWorkflowEdge({
        id: 'edge-remove',
        source: 'condition-0',
        source_handle: 'branch:branch-remove',
        target: 'agent-2',
        type: 'condition_branch',
      }),
    ];

    const state = createWorkflowAuthoringState(graph);
    const configured = dispatchWorkflowAuthoringCommand(state, {
      type: 'configure-node',
      nodeId: 'condition-0',
      patch: { branches: [{ id: 'branch-keep', condition: 'Keep' }] },
    }).state;

    expect(configured.graph.edges.map((edge) => edge.id)).toEqual([
      'edge-keep',
    ]);
    expect(configured.graph.nodes[0].data.branches).toEqual([
      expect.objectContaining({ id: 'branch-keep' }),
    ]);

    const restored = undoWorkflowAuthoring(configured);
    expect(restored.graph.edges.map((edge) => edge.id)).toEqual([
      'edge-keep',
      'edge-remove',
    ]);
    expect(restored.graph.nodes[0].data.branches).toHaveLength(2);
  });

  it('removes Reject edges when a Human Gate becomes approve-only', () => {
    const graph = graphWith('human_gate', 'agent', 'agent');
    graph.edges = [
      createWorkflowEdge({
        id: 'approved',
        source: 'human_gate-0',
        source_handle: 'approve',
        target: 'agent-1',
        type: 'approval',
      }),
      createWorkflowEdge({
        id: 'rejected',
        source: 'human_gate-0',
        source_handle: 'reject',
        target: 'agent-2',
        type: 'rejection',
      }),
    ];

    const state = createWorkflowAuthoringState(graph);
    const configured = dispatchWorkflowAuthoringCommand(state, {
      type: 'configure-node',
      nodeId: 'human_gate-0',
      patch: { required_action: 'approve' },
    }).state;

    expect(configured.graph.edges.map((edge) => edge.id)).toEqual(['approved']);
    expect(getWorkflowNodeSourceHandles(configured.graph.nodes[0])).toEqual([
      expect.objectContaining({ id: 'approve' }),
    ]);

    const restored = undoWorkflowAuthoring(configured);
    expect(restored.graph.nodes[0].data.required_action).toBe(
      'approve_or_reject'
    );
    expect(restored.graph.edges.map((edge) => edge.id)).toEqual([
      'approved',
      'rejected',
    ]);
  });

  it('moves a multi-selection as one history entry', () => {
    const state = createWorkflowAuthoringState(graphWith('agent', 'transform'));
    const moved = dispatchWorkflowAuthoringCommand(state, {
      type: 'move-nodes',
      positions: {
        'agent-0': { x: 240, y: 320 },
        'transform-1': { x: 540, y: 320 },
      },
    }).state;

    expect(moved.undoStack).toHaveLength(1);
    expect(moved.undoStack[0].forward.nodes).toHaveLength(2);
    expect(moved.graph.nodes.map((node) => node.position)).toEqual([
      { x: 240, y: 320 },
      { x: 540, y: 320 },
    ]);
  });

  it('keeps graph metadata in the same reversible Draft history', () => {
    const initial = createWorkflowAuthoringState(graphWith('start', 'end'));
    const configured = commitWorkflowAuthoringGraph(initial, {
      ...initial.graph,
      router_executor_config: { executor: 'CLAUDE_CODE' },
      canvas: {
        notes: [
          {
            id: 'note-1',
            type: 'sticky_note',
            content: 'Review the result',
            position: { x: 120, y: 40 },
            size: { width: 240, height: 120 },
          },
        ],
      },
    });

    expect(configured.graph.router_executor_config).toEqual({
      executor: 'CLAUDE_CODE',
    });
    expect(configured.graph.canvas?.notes).toHaveLength(1);
    expect(configured.undoStack[0].forward.metadata).not.toBeNull();

    const restored = undoWorkflowAuthoring(configured);
    expect(restored.graph.router_executor_config).toBeUndefined();
    expect(restored.graph.canvas).toBeUndefined();
    expect(redoWorkflowAuthoring(restored).graph.canvas?.notes).toHaveLength(1);
  });

  it('splits an edge atomically and restores the exact original edge', () => {
    const graph = graphWith('condition', 'end');
    graph.nodes[0].data.branches = [{ id: 'approved', condition: 'Approved' }];
    graph.edges = [
      createWorkflowEdge({
        id: 'original',
        source: 'condition-0',
        source_handle: 'branch:approved',
        target: 'end-1',
        target_handle: 'custom-input',
        type: 'condition_branch',
        data: { route: { bend: { x: 280, y: 80 } } },
      }),
    ];
    const state = createWorkflowAuthoringState(graph);
    const split = dispatchWorkflowAuthoringCommand(
      state,
      {
        type: 'split-edge',
        edgeId: 'original',
        nodeType: 'agent',
        nodeId: 'task-node',
        position: { x: 300, y: 120 },
      },
      ids('edge-before', 'edge-after')
    ).state;

    expect(split.graph.nodes.map((node) => node.id)).toContain('task-node');
    expect(split.graph.edges.map((edge) => edge.id)).toEqual([
      'edge-before',
      'edge-after',
    ]);
    expect(split.graph.edges[0]).toEqual(
      expect.objectContaining({
        source_handle: 'branch:approved',
        type: 'condition_branch',
        data: { route: { bend: { x: 280, y: 80 } } },
      })
    );
    expect(split.graph.edges[1]).toEqual(
      expect.objectContaining({ target_handle: 'custom-input' })
    );
    expect(undoWorkflowAuthoring(split).graph.edges).toEqual([
      expect.objectContaining({ id: 'original' }),
    ]);
  });

  it('splits an edge with an existing Node as one reversible command', () => {
    const graph = graphWith('start', 'transform', 'end');
    graph.edges = [
      createWorkflowEdge({
        id: 'original',
        source: 'start-0',
        target: 'end-2',
      }),
    ];
    const state = createWorkflowAuthoringState(graph);
    const split = dispatchWorkflowAuthoringCommand(
      state,
      {
        type: 'split-edge-with-node',
        edgeId: 'original',
        nodeId: 'transform-1',
        position: { x: 300, y: 180 },
      },
      ids('before', 'after')
    ).state;

    expect(split.graph.edges.map((edge) => edge.id)).toEqual([
      'before',
      'after',
    ]);
    expect(split.graph.nodes[1].position).toEqual({ x: 300, y: 180 });
    expect(split.undoStack).toHaveLength(1);
    const restored = undoWorkflowAuthoring(split);
    expect(restored.graph.edges).toEqual([
      expect.objectContaining({ id: 'original' }),
    ]);
    expect(restored.graph.nodes[1].position).toEqual({ x: 300, y: 120 });
  });

  it('acknowledges immutable save snapshots without overwriting later edits', () => {
    const initial = createWorkflowAuthoringState(graphWith('agent'), 7);
    const firstEdit = dispatchWorkflowAuthoringCommand(initial, {
      type: 'configure-node',
      nodeId: 'agent-0',
      patch: { display_name: 'First edit' },
    }).state;
    const snapshot = createWorkflowSaveSnapshot(firstEdit);
    const laterEdit = dispatchWorkflowAuthoringCommand(firstEdit, {
      type: 'configure-node',
      nodeId: 'agent-0',
      patch: { display_name: 'Later edit' },
    }).state;
    const acknowledged = acknowledgeWorkflowSave(laterEdit, snapshot, 8);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.graph.nodes[0].data)).toBe(true);
    expect(acknowledged.graph.nodes[0].data.display_name).toBe('Later edit');
    expect(acknowledged.persistedGraph.nodes[0].data.display_name).toBe(
      'First edit'
    );
    expect(acknowledged.serverRevision).toBe(8);
    expect(acknowledged.dirty).toBe(true);

    const stale = acknowledgeWorkflowSave(acknowledged, snapshot, 9);
    expect(stale).toBe(acknowledged);
  });

  it('reports connection issues through the shared validator', () => {
    const graph = graphWith('end', 'agent');
    expect(
      validateWorkflowConnection(graph, {
        source: 'end-0',
        sourceHandle: 'default',
        target: 'agent-1',
      })?.code
    ).toBe('end-source');
  });

  it('keeps incomplete Agent and Condition Nodes pending', () => {
    const graph = graphWith('agent', 'condition');

    expect(validateWorkflowAuthoringGraph(graph)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'agent-0',
          field: 'executor_config',
        }),
        expect.objectContaining({
          nodeId: 'condition-1',
          field: 'branches',
        }),
      ])
    );
  });

  it('validates and evaluates all Transform modes with runtime semantics', () => {
    expect(
      applyWorkflowTransform(
        { mode: 'template', template: 'Review:\n{{upstream}}' },
        'hello'
      )
    ).toEqual({ ok: true, output: 'Review:\nhello' });
    expect(
      applyWorkflowTransform(
        { mode: 'regex_extract', regex: 'issue #(\\d+)' },
        'fix issue #42 today'
      )
    ).toEqual({ ok: true, output: '42' });
    expect(
      applyWorkflowTransform({ mode: 'truncate', max_chars: 4 }, 'aébcdef')
    ).toEqual({ ok: true, output: 'aébc' });
    expect(
      applyWorkflowTransform({ mode: 'regex_extract', regex: '[' }, 'input')
    ).toMatchObject({ ok: false });

    const graph = graphWith('transform');
    graph.nodes[0].data = { mode: 'truncate', max_chars: 0 };
    expect(validateWorkflowAuthoringGraph(graph)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeId: 'transform-0',
          field: 'max_chars',
        }),
      ])
    );
  });
});
