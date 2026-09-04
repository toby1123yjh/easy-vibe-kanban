import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_GRAPH_VERSION,
  DEFAULT_SOURCE_HANDLE,
  DEFAULT_TARGET_HANDLE,
  createWorkflowCanvasStageGroup,
  createWorkflowCanvasStickyNote,
  createDefaultWorkflowGraph,
  createWorkflowEdge,
  createWorkflowNode,
  fromReactFlowCanvasGraph,
  fromReactFlowGraph,
  getConditionBranchTargets,
  instantiateWorkflowGraphTemplate,
  migrateWorkflowGraph,
  normalizeConditionEdgeTypes,
  syncConditionBranches,
  tidyWorkflowGraph,
  toReactFlowCanvasNodes,
  toReactFlowEdges,
  toReactFlowNodes,
  type WorkflowGraph,
} from './workflowGraph';
import {
  WORKFLOW_NODE_CATALOG,
  createDefaultNodeData,
} from './workflowNodeCatalog';

describe('workflow graph model', () => {
  it('creates a default issue workflow skeleton compatible with backend schema', () => {
    const graph = createDefaultWorkflowGraph();

    expect(graph.version).toBe(WORKFLOW_GRAPH_VERSION);
    expect(graph.nodes).toEqual([
      {
        id: 'start',
        type: 'start',
        data: { display_name: 'Start' },
        position: { x: 120, y: 190 },
      },
      {
        id: 'familiarize',
        type: 'agent',
        data: {
          display_name: 'Understand project',
          role_template_id: 'custom',
          prompt_template:
            'Review the current project structure, key modules, and task context. Summarize your understanding, risks, and next implementation plan.',
        },
        position: { x: 420, y: 160 },
      },
      {
        id: 'end',
        type: 'end',
        data: { display_name: 'End' },
        position: { x: 780, y: 190 },
      },
    ]);
    expect(graph.edges).toEqual([
      {
        id: 'start-familiarize',
        source: 'start',
        source_handle: DEFAULT_SOURCE_HANDLE,
        target: 'familiarize',
        target_handle: DEFAULT_TARGET_HANDLE,
        type: 'default',
      },
      {
        id: 'familiarize-end',
        source: 'familiarize',
        source_handle: DEFAULT_SOURCE_HANDLE,
        target: 'end',
        target_handle: DEFAULT_TARGET_HANDLE,
        type: 'default',
      },
    ]);
    expect(graph.canvas?.groups?.[0]).toMatchObject({
      id: 'stage-understand',
      type: 'stage_group',
      title: 'Stage 1: Understand project',
      position: { x: 70, y: 105 },
      size: { width: 880, height: 240 },
    });
  });

  it('instantiates templates without reusing persisted agent sessions', () => {
    const graph = instantiateWorkflowGraphTemplate({
      version: 1,
      nodes: [
        {
          id: 'start',
          type: 'start',
          data: { display_name: 'Start' },
        },
        {
          id: 'agent',
          type: 'agent',
          data: {
            display_name: 'Agent',
            session_id: 'session-from-template',
            executor_config: { executor: 'CODEX' },
          },
        },
      ],
      edges: [
        {
          id: 'start-agent',
          source: 'start',
          target: 'agent',
          type: 'default',
        },
      ],
    });

    expect(graph.version).toBe(WORKFLOW_GRAPH_VERSION);
    expect(graph.nodes[1].data.session_id).toBeUndefined();
    expect(graph.nodes[1].data.executor_config).toEqual({ executor: 'CODEX' });
    expect(graph.edges[0].source_handle).toBe(DEFAULT_SOURCE_HANDLE);
  });

  it('defines catalog entries and default data for every v1 node kind', () => {
    expect(WORKFLOW_NODE_CATALOG.map((item) => item.type)).toEqual([
      'start',
      'end',
      'agent',
      'condition',
      'human_gate',
      'transform',
      'arena',
    ]);

    expect(createDefaultNodeData('agent')).toMatchObject({
      display_name: 'Agent',
      role_template_id: 'custom',
      prompt_template: '',
    });
    expect(createDefaultNodeData('condition')).toMatchObject({
      display_name: 'Condition',
      routing_mode: 'single',
      branches: [],
    });
    expect(createDefaultNodeData('human_gate')).toMatchObject({
      display_name: 'Human Gate',
      required_action: 'approve_or_reject',
    });
    expect(createDefaultNodeData('transform')).toMatchObject({
      display_name: 'Transform',
      mode: 'template',
      template: '{{input}}',
    });
    expect(createDefaultNodeData('arena')).toMatchObject({
      display_name: 'Arena',
      promote_strategy: 'manual',
      apply_strategy: 'diff_apply',
      attempts: [
        {
          id: 'attempt-a',
          display_name: 'Attempt A',
          role_template_id: 'custom',
          prompt_template: '',
        },
        {
          id: 'attempt-b',
          display_name: 'Attempt B',
          role_template_id: 'custom',
          prompt_template: '',
        },
      ],
    });
  });

  it('returns fresh default data objects so catalog defaults are not mutated', () => {
    const first = createDefaultNodeData('condition');
    const second = createDefaultNodeData('condition');

    first.branches?.push({ target_node_id: 'changed' });

    expect(second.branches).toEqual([]);
  });

  it('maps backend graph nodes to React Flow nodes without changing node data', () => {
    const agent = createWorkflowNode('agent', { id: 'agent-1' });
    const flowNodes = toReactFlowNodes({
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [agent],
      edges: [],
    });

    expect(flowNodes).toHaveLength(1);
    expect(flowNodes[0]).toMatchObject({
      id: 'agent-1',
      type: 'agent',
      data: agent.data,
      position: { x: 0, y: 0 },
    });
  });

  it('preserves workflow node positions through React Flow conversion', () => {
    const agent = createWorkflowNode('agent', {
      id: 'agent-1',
      position: { x: 320, y: 180 },
    });

    const flowNodes = toReactFlowNodes(
      {
        version: WORKFLOW_GRAPH_VERSION,
        nodes: [agent],
        edges: [],
      },
      {
        'agent-1': { x: 20, y: 20 },
      }
    );

    expect(flowNodes[0].position).toEqual({ x: 320, y: 180 });

    const graph = fromReactFlowGraph(
      [
        {
          id: 'agent-1',
          type: 'agent',
          data: agent.data,
          position: { x: 480, y: 260 },
        },
      ],
      []
    );

    expect(graph.nodes[0].position).toEqual({ x: 480, y: 260 });
  });

  it('keeps canvas notes and stage groups out of runtime graph nodes', () => {
    const agent = createWorkflowNode('agent', {
      id: 'agent-1',
      position: { x: 320, y: 180 },
    });
    const graph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [agent],
      edges: [],
      canvas: {
        notes: [
          createWorkflowCanvasStickyNote({
            id: 'note-1',
            title: 'Context',
            content: 'Read first',
            position: { x: 120, y: 40 },
            size: { width: 260, height: 140 },
          }),
        ],
        groups: [
          createWorkflowCanvasStageGroup({
            id: 'stage-1',
            title: 'Stage 1',
            position: { x: 80, y: 120 },
            size: { width: 520, height: 220 },
          }),
        ],
      },
    };

    const flowNodes = toReactFlowCanvasNodes(graph);

    expect(flowNodes.map((node) => node.type)).toEqual([
      'stage_group',
      'agent',
      'sticky_note',
    ]);

    const roundTrip = fromReactFlowCanvasGraph(
      flowNodes.map((node) =>
        node.id === 'note-1'
          ? {
              ...node,
              data: {
                ...node.data,
                content: 'Updated note',
                __workflowCanvasObjectActions: {},
              },
              position: { x: 180, y: 60 },
              style: { width: 300, height: 160 },
            }
          : node
      ),
      [],
      graph
    );

    expect(roundTrip.nodes).toEqual([agent]);
    expect(roundTrip.canvas?.notes?.[0]).toMatchObject({
      id: 'note-1',
      content: 'Updated note',
      position: { x: 180, y: 60 },
      size: { width: 300, height: 160 },
    });
    expect(roundTrip.canvas?.groups?.[0]).toMatchObject({
      id: 'stage-1',
      title: 'Stage 1',
    });
  });

  it('tidies workflow nodes into readable horizontal levels', () => {
    const graph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        createWorkflowNode('start', {
          id: 'start',
          position: { x: 600, y: 300 },
        }),
        createWorkflowNode('agent', {
          id: 'research',
          position: { x: 20, y: 20 },
        }),
        createWorkflowNode('agent', {
          id: 'review',
          position: { x: 80, y: 500 },
        }),
        createWorkflowNode('end', {
          id: 'end',
          position: { x: 100, y: 80 },
        }),
      ],
      edges: [
        createWorkflowEdge({
          id: 'start-research',
          source: 'start',
          target: 'research',
        }),
        createWorkflowEdge({
          id: 'research-review',
          source: 'research',
          target: 'review',
        }),
        createWorkflowEdge({
          id: 'review-end',
          source: 'review',
          target: 'end',
        }),
      ],
    };

    const tidy = tidyWorkflowGraph(graph);
    const positions = new Map(
      tidy.nodes.map((node) => [node.id, node.position])
    );

    expect(positions.get('start')?.x).toBeLessThan(
      positions.get('research')?.x ?? 0
    );
    expect(positions.get('research')?.x).toBeLessThan(
      positions.get('review')?.x ?? 0
    );
    expect(positions.get('review')?.x).toBeLessThan(
      positions.get('end')?.x ?? 0
    );
    for (const position of positions.values()) {
      expect(position?.y).toBeGreaterThanOrEqual(70);
    }
    expect(tidy.edges[0]).toMatchObject({
      source_handle: DEFAULT_SOURCE_HANDLE,
      target_handle: DEFAULT_TARGET_HANDLE,
    });
  });

  it('tidies mixed-size nodes with enough lane spacing for readable edges', () => {
    const graph: WorkflowGraph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        createWorkflowNode('start', {
          id: 'start',
          position: { x: 0, y: 0 },
        }),
        createWorkflowNode('condition', {
          id: 'branch',
          position: { x: 200, y: 60 },
        }),
        createWorkflowNode('arena', {
          id: 'arena',
          position: { x: 500, y: 20 },
        }),
        createWorkflowNode('human_gate', {
          id: 'approval',
          position: { x: 500, y: 600 },
        }),
        createWorkflowNode('end', {
          id: 'end',
          position: { x: 900, y: 120 },
        }),
      ],
      edges: [
        createWorkflowEdge({
          id: 'start-branch',
          source: 'start',
          target: 'branch',
        }),
        createWorkflowEdge({
          id: 'branch-arena',
          source: 'branch',
          target: 'arena',
        }),
        createWorkflowEdge({
          id: 'branch-approval',
          source: 'branch',
          target: 'approval',
        }),
        createWorkflowEdge({
          id: 'arena-end',
          source: 'arena',
          target: 'end',
        }),
        createWorkflowEdge({
          id: 'approval-end',
          source: 'approval',
          target: 'end',
        }),
      ],
    };

    const tidy = tidyWorkflowGraph(graph);
    const positions = new Map(
      tidy.nodes.map((node) => [node.id, node.position])
    );
    const branchCenterY = (positions.get('branch')?.y ?? 0) + 66;
    const arenaCenterY = (positions.get('arena')?.y ?? 0) + 85;
    const approvalCenterY = (positions.get('approval')?.y ?? 0) + 66;

    expect(positions.get('start')?.x).toBeLessThan(
      positions.get('branch')?.x ?? 0
    );
    expect(positions.get('branch')?.x).toBeLessThan(
      positions.get('arena')?.x ?? 0
    );
    expect(positions.get('arena')?.x).toBeLessThan(
      positions.get('end')?.x ?? 0
    );
    expect(positions.get('approval')?.y).toBeGreaterThan(
      (positions.get('arena')?.y ?? 0) + 170
    );
    expect(
      Math.abs(branchCenterY - (arenaCenterY + approvalCenterY) / 2)
    ).toBeLessThan(1);
    expect(
      tidy.edges.map((edge) => [
        edge.id,
        edge.source_handle,
        edge.target_handle,
      ])
    ).toEqual([
      ['start-branch', DEFAULT_SOURCE_HANDLE, DEFAULT_TARGET_HANDLE],
      ['branch-arena', 'branch:branch-arena', DEFAULT_TARGET_HANDLE],
      ['branch-approval', 'branch:branch-approval', DEFAULT_TARGET_HANDLE],
      ['arena-end', DEFAULT_SOURCE_HANDLE, DEFAULT_TARGET_HANDLE],
      ['approval-end', DEFAULT_SOURCE_HANDLE, DEFAULT_TARGET_HANDLE],
    ]);
  });

  it('uses connected lane order to reduce crossing-prone branch layouts', () => {
    const graph: WorkflowGraph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        createWorkflowNode('start', { id: 'start' }),
        createWorkflowNode('condition', { id: 'split' }),
        createWorkflowNode('agent', {
          id: 'frontend',
          position: { x: 500, y: 20 },
        }),
        createWorkflowNode('agent', {
          id: 'backend',
          position: { x: 500, y: 500 },
        }),
        createWorkflowNode('agent', {
          id: 'backend-review',
          position: { x: 900, y: 20 },
        }),
        createWorkflowNode('agent', {
          id: 'frontend-review',
          position: { x: 900, y: 500 },
        }),
        createWorkflowNode('end', { id: 'end' }),
      ],
      edges: [
        createWorkflowEdge({
          id: 'start-split',
          source: 'start',
          target: 'split',
        }),
        createWorkflowEdge({
          id: 'split-frontend',
          source: 'split',
          target: 'frontend',
          type: 'condition_branch',
        }),
        createWorkflowEdge({
          id: 'split-backend',
          source: 'split',
          target: 'backend',
          type: 'condition_branch',
        }),
        createWorkflowEdge({
          id: 'frontend-review',
          source: 'frontend',
          target: 'frontend-review',
        }),
        createWorkflowEdge({
          id: 'backend-review',
          source: 'backend',
          target: 'backend-review',
        }),
        createWorkflowEdge({
          id: 'frontend-review-end',
          source: 'frontend-review',
          target: 'end',
        }),
        createWorkflowEdge({
          id: 'backend-review-end',
          source: 'backend-review',
          target: 'end',
        }),
      ],
    };

    const tidy = tidyWorkflowGraph(graph);
    const positions = new Map(
      tidy.nodes.map((node) => [node.id, node.position])
    );

    expect(positions.get('frontend')?.y).toBeLessThan(
      positions.get('backend')?.y ?? 0
    );
    expect(positions.get('frontend-review')?.y).toBeLessThan(
      positions.get('backend-review')?.y ?? 0
    );
  });

  it('keeps workflow edge semantics separate from React Flow edge renderer type', () => {
    const edge = createWorkflowEdge({
      id: 'review-approve',
      source: 'review',
      source_handle: DEFAULT_SOURCE_HANDLE,
      target: 'ship',
      target_handle: DEFAULT_TARGET_HANDLE,
      type: 'approval',
    });

    const flowEdges = toReactFlowEdges({
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [],
      edges: [edge],
    });

    expect(flowEdges[0]).toMatchObject({
      id: 'review-approve',
      source: 'review',
      target: 'ship',
      type: 'workflow',
      data: { workflowType: 'approval' },
      label: 'Approve',
    });

    const graph = fromReactFlowGraph([], flowEdges);

    expect(graph.edges[0]).toEqual(edge);
  });

  it('preserves edge handles through React Flow conversion', () => {
    const edge = createWorkflowEdge({
      id: 'condition-true',
      source: 'condition',
      source_handle: 'branch:true',
      target: 'agent',
      target_handle: 'input',
      type: 'condition_branch',
    });

    const flowEdges = toReactFlowEdges({
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [],
      edges: [edge],
    });

    expect(flowEdges[0]).toMatchObject({
      sourceHandle: 'branch:true',
      targetHandle: 'input',
    });

    const graph = fromReactFlowGraph(
      [
        {
          id: 'condition',
          type: 'condition',
          data: createDefaultNodeData('condition'),
          position: { x: 0, y: 0 },
        },
        {
          id: 'agent',
          type: 'agent',
          data: createDefaultNodeData('agent'),
          position: { x: 320, y: 0 },
        },
      ],
      flowEdges
    );

    expect(graph.edges[0]).toEqual(edge);
  });

  it('migrates legacy v1 graphs to single-port edge handles', () => {
    const graph = migrateWorkflowGraph({
      version: 1,
      nodes: [
        { id: 'start', type: 'start', data: { display_name: 'Start' } },
        { id: 'agent', type: 'agent', data: { display_name: 'Agent' } },
      ],
      edges: [
        {
          id: 'start-agent',
          source: 'start',
          target: 'agent',
          type: 'default',
        },
      ],
    });

    expect(graph.version).toBe(WORKFLOW_GRAPH_VERSION);
    expect(graph.edges[0]).toMatchObject({
      source_handle: DEFAULT_SOURCE_HANDLE,
      target_handle: DEFAULT_TARGET_HANDLE,
    });
    expect(graph.nodes[0].position).toEqual({ x: 120, y: 160 });
  });

  it('normalizes legacy input and output handle ids to shared ports', () => {
    const graph = migrateWorkflowGraph({
      version: 2,
      nodes: [],
      edges: [
        {
          id: 'a-b',
          source: 'a',
          source_handle: 'output-bottom',
          target: 'b',
          target_handle: 'input-top',
          type: 'default',
        },
      ],
    });

    expect(graph.edges[0].source_handle).toBe(DEFAULT_SOURCE_HANDLE);
    expect(graph.edges[0].target_handle).toBe(DEFAULT_TARGET_HANDLE);
  });

  it('does not overwrite existing v2 handles', () => {
    const graph = migrateWorkflowGraph({
      version: 2,
      nodes: [],
      edges: [
        {
          id: 'a-b',
          source: 'a',
          source_handle: 'right',
          target: 'b',
          target_handle: 'left',
          type: 'default',
        },
      ],
    });

    expect(graph.edges[0].source_handle).toBe('right');
    expect(graph.edges[0].target_handle).toBe('left');
  });

  it('continues to read legacy semantic edge types from React Flow edge type', () => {
    const graph = fromReactFlowGraph(
      [],
      [
        {
          id: 'review-reject',
          source: 'review',
          target: 'fix',
          type: 'rejection',
        },
      ]
    );

    expect(graph.edges[0].type).toBe('rejection');
  });

  it('drops React Flow node UI data when converting back to workflow graph', () => {
    const graph = fromReactFlowGraph(
      [
        {
          id: 'agent-1',
          type: 'agent',
          data: {
            display_name: 'Agent',
            __validationIssues: [{ message: 'UI only' }],
          },
          position: { x: 120, y: 80 },
        },
      ],
      []
    );

    expect(graph.nodes[0].data).toEqual({ display_name: 'Agent' });
  });

  it('syncs condition branch rows with outgoing condition targets', () => {
    const condition = createWorkflowNode('condition', { id: 'condition' });
    const graph: WorkflowGraph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        condition,
        createWorkflowNode('agent', {
          id: 'yes',
          data: { display_name: 'Yes path' },
        }),
        createWorkflowNode('agent', {
          id: 'no',
          data: { display_name: 'No path' },
        }),
      ],
      edges: [
        createWorkflowEdge({
          id: 'condition-yes',
          source: 'condition',
          target: 'yes',
          type: 'condition_branch',
        }),
        createWorkflowEdge({
          id: 'condition-no',
          source: 'condition',
          target: 'no',
          type: 'condition_branch',
        }),
      ],
    };

    const updated = syncConditionBranches(graph);

    expect(updated.nodes[0].data.branches).toEqual([
      {
        id: 'branch-condition-yes',
        target_node_id: 'yes',
        condition: '',
      },
      {
        id: 'branch-condition-no',
        target_node_id: 'no',
        condition: '',
      },
    ]);
    expect(getConditionBranchTargets(updated, 'condition')).toEqual([
      { nodeId: 'yes', label: 'Yes path', edgeIds: ['condition-yes'] },
      { nodeId: 'no', label: 'No path', edgeIds: ['condition-no'] },
    ]);
  });

  it('removes stale condition branch rows when outgoing edges are removed', () => {
    const graph: WorkflowGraph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        createWorkflowNode('condition', {
          id: 'condition',
          data: {
            branches: [
              { target_node_id: 'yes', condition: 'Route to yes' },
              { target_node_id: 'no', condition: 'Route to no' },
            ],
          },
        }),
        createWorkflowNode('agent', { id: 'yes' }),
        createWorkflowNode('agent', { id: 'no' }),
      ],
      edges: [
        createWorkflowEdge({
          id: 'condition-yes',
          source: 'condition',
          target: 'yes',
          type: 'condition_branch',
        }),
      ],
    };

    const updated = syncConditionBranches(graph);

    expect(updated.nodes[0].data.branches).toEqual([
      {
        id: 'branch-condition-yes',
        target_node_id: 'yes',
        condition: 'Route to yes',
      },
    ]);
  });

  it('strips legacy condition rule fields when syncing condition branches', () => {
    const graph: WorkflowGraph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        createWorkflowNode('condition', {
          id: 'condition',
          data: {
            conditions: [
              {
                operator: 'contains',
                value: 'UI',
              },
            ],
            joiner: 'and',
            branches: [
              { target_node_id: 'agent', condition: 'Route to agent' },
            ],
          },
        }),
        createWorkflowNode('agent', { id: 'agent' }),
      ],
      edges: [
        createWorkflowEdge({
          id: 'condition-agent',
          source: 'condition',
          target: 'agent',
          type: 'condition_branch',
        }),
      ],
    };

    const updated = syncConditionBranches(graph);

    expect('conditions' in updated.nodes[0].data).toBe(false);
    expect('joiner' in updated.nodes[0].data).toBe(false);
    expect(updated.nodes[0].data.branches).toEqual([
      {
        id: 'branch-condition-agent',
        target_node_id: 'agent',
        condition: 'Route to agent',
      },
    ]);
  });

  it('preserves branch conditions when an outgoing condition edge is retargeted', () => {
    const previousGraph: WorkflowGraph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        createWorkflowNode('condition', {
          id: 'condition',
          data: {
            branches: [
              {
                id: 'branch-review',
                target_node_id: 'review',
                condition: 'Needs review',
              },
            ],
          },
        }),
        createWorkflowNode('agent', { id: 'review' }),
        createWorkflowNode('agent', { id: 'implement' }),
        createWorkflowNode('end', { id: 'end' }),
      ],
      edges: [
        createWorkflowEdge({
          id: 'condition-out',
          source: 'condition',
          target: 'review',
          type: 'condition_branch',
        }),
      ],
    };
    const nextGraph: WorkflowGraph = {
      ...previousGraph,
      edges: [
        createWorkflowEdge({
          id: 'condition-out',
          source: 'condition',
          target: 'implement',
          type: 'condition_branch',
        }),
      ],
    };

    const updated = syncConditionBranches(nextGraph, previousGraph);

    expect(updated.nodes[0].data.branches).toEqual([
      {
        id: 'branch-review',
        target_node_id: 'implement',
        condition: 'Needs review',
      },
    ]);
  });

  it('normalizes condition edge types from the source node kind', () => {
    const graph: WorkflowGraph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        createWorkflowNode('condition', { id: 'condition' }),
        createWorkflowNode('agent', { id: 'agent' }),
        createWorkflowNode('end', { id: 'end' }),
      ],
      edges: [
        createWorkflowEdge({
          id: 'condition-agent',
          source: 'condition',
          target: 'agent',
          type: 'default',
        }),
        createWorkflowEdge({
          id: 'agent-end',
          source: 'agent',
          target: 'end',
          type: 'condition_branch',
        }),
      ],
    };

    expect(normalizeConditionEdgeTypes(graph).edges).toEqual([
      expect.objectContaining({
        id: 'condition-agent',
        type: 'condition_branch',
      }),
      expect.objectContaining({ id: 'agent-end', type: 'default' }),
    ]);
  });

  it('preserves workflow-level router executor config through graph conversion', () => {
    const graph: WorkflowGraph = {
      version: WORKFLOW_GRAPH_VERSION,
      router_executor_config: { executor: 'codex' },
      nodes: [createWorkflowNode('agent', { id: 'agent' })],
      edges: [],
    };

    expect(migrateWorkflowGraph(graph).router_executor_config).toEqual({
      executor: 'codex',
    });
    expect(
      fromReactFlowGraph(
        toReactFlowNodes(graph),
        toReactFlowEdges(graph),
        graph
      ).router_executor_config
    ).toEqual({ executor: 'codex' });
  });
});
