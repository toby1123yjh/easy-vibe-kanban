import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_GRAPH_VERSION,
  WORKFLOW_PORT_HANDLE_IDS,
  DEFAULT_SOURCE_HANDLE,
  DEFAULT_TARGET_HANDLE,
  clearConditionBranchTargetForEdge,
  createWorkflowCanvasStageGroup,
  createWorkflowCanvasStickyNote,
  createDefaultWorkflowGraph,
  createWorkflowEdge,
  createWorkflowNode,
  fromReactFlowCanvasGraph,
  fromReactFlowGraph,
  getConditionBranchNameForEdge,
  getConditionBranchNamesForEdge,
  migrateWorkflowGraph,
  setConditionBranchTargetForEdge,
  tidyWorkflowGraph,
  toReactFlowCanvasNodes,
  toReactFlowEdges,
  toReactFlowNodes,
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
      joiner: 'and',
      conditions: [
        {
          input: '{{input}}',
          operator: 'contains',
          value: '',
        },
      ],
      branches: [{ name: 'true' }, { name: 'false' }],
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

    first.conditions?.[0] && (first.conditions[0].value = 'changed');

    expect(second.conditions?.[0]?.value).toBe('');
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

    expect(tidy.nodes.map((node) => [node.id, node.position])).toEqual([
      ['start', { x: 120, y: 148 }],
      ['research', { x: 420, y: 105 }],
      ['review', { x: 860, y: 105 }],
      ['end', { x: 1300, y: 148 }],
    ]);
    expect(tidy.edges[0]).toMatchObject({
      source_handle: WORKFLOW_PORT_HANDLE_IDS.right,
      target_handle: WORKFLOW_PORT_HANDLE_IDS.left,
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

    expect(tidy.nodes.map((node) => [node.id, node.position])).toEqual([
      ['start', { x: 120, y: 148 }],
      ['branch', { x: 420, y: 114 }],
      ['arena', { x: 840, y: 70 }],
      ['approval', { x: 850, y: 296 }],
      ['end', { x: 1280, y: 148 }],
    ]);
    expect(
      tidy.edges.map((edge) => [
        edge.id,
        edge.source_handle,
        edge.target_handle,
      ])
    ).toEqual([
      [
        'start-branch',
        WORKFLOW_PORT_HANDLE_IDS.right,
        WORKFLOW_PORT_HANDLE_IDS.left,
      ],
      [
        'branch-arena',
        WORKFLOW_PORT_HANDLE_IDS.right,
        WORKFLOW_PORT_HANDLE_IDS.left,
      ],
      [
        'branch-approval',
        WORKFLOW_PORT_HANDLE_IDS.right,
        WORKFLOW_PORT_HANDLE_IDS.left,
      ],
      [
        'arena-end',
        WORKFLOW_PORT_HANDLE_IDS.right,
        WORKFLOW_PORT_HANDLE_IDS.left,
      ],
      [
        'approval-end',
        WORKFLOW_PORT_HANDLE_IDS.right,
        WORKFLOW_PORT_HANDLE_IDS.left,
      ],
    ]);
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

    expect(fromReactFlowGraph([], flowEdges).edges[0]).toEqual(edge);
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

    expect(graph.edges[0].source_handle).toBe(WORKFLOW_PORT_HANDLE_IDS.bottom);
    expect(graph.edges[0].target_handle).toBe(WORKFLOW_PORT_HANDLE_IDS.top);
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

  it('maps condition branch names to selected edge targets', () => {
    const condition = createWorkflowNode('condition', { id: 'condition' });
    const graph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        condition,
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
        createWorkflowEdge({
          id: 'condition-no',
          source: 'condition',
          target: 'no',
          type: 'condition_branch',
        }),
      ],
    };

    const updated = setConditionBranchTargetForEdge(
      graph,
      'condition-yes',
      'true'
    );

    expect(updated.nodes[0].data.branches).toEqual([
      { name: 'true', target_node_id: 'yes' },
      { name: 'false' },
    ]);
    expect(getConditionBranchNameForEdge(updated, 'condition-yes')).toBe(
      'true'
    );
    expect(getConditionBranchNamesForEdge(updated, 'condition-no')).toEqual([
      'true',
      'false',
    ]);
  });

  it('clears condition branch target mappings for selected edges', () => {
    const graph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        createWorkflowNode('condition', {
          id: 'condition',
          data: {
            branches: [
              { name: 'true', target_node_id: 'yes' },
              { name: 'false', target_node_id: 'no' },
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

    const updated = clearConditionBranchTargetForEdge(graph, 'condition-yes');

    expect(updated.nodes[0].data.branches).toEqual([
      { name: 'true' },
      { name: 'false', target_node_id: 'no' },
    ]);
    expect(getConditionBranchNameForEdge(updated, 'condition-yes')).toBeNull();
  });

  it('does not mutate graph when branch mapping a non-condition edge', () => {
    const graph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        createWorkflowNode('agent', { id: 'agent' }),
        createWorkflowNode('end', { id: 'end' }),
      ],
      edges: [
        createWorkflowEdge({
          id: 'agent-end',
          source: 'agent',
          target: 'end',
        }),
      ],
    };

    expect(setConditionBranchTargetForEdge(graph, 'agent-end', 'true')).toBe(
      graph
    );
  });
});
