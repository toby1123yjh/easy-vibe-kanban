import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_GRAPH_VERSION,
  clearConditionBranchTargetForEdge,
  createDefaultWorkflowGraph,
  createWorkflowEdge,
  createWorkflowNode,
  fromReactFlowGraph,
  getConditionBranchNameForEdge,
  getConditionBranchNamesForEdge,
  setConditionBranchTargetForEdge,
  toReactFlowEdges,
  toReactFlowNodes,
} from './workflowGraph';
import {
  WORKFLOW_NODE_CATALOG,
  createDefaultNodeData,
} from './workflowNodeCatalog';

describe('workflow graph model', () => {
  it('creates a minimal start to end graph compatible with backend schema', () => {
    const graph = createDefaultWorkflowGraph();

    expect(graph.version).toBe(WORKFLOW_GRAPH_VERSION);
    expect(graph.nodes).toEqual([
      {
        id: 'start',
        type: 'start',
        data: { display_name: 'Start' },
      },
      {
        id: 'end',
        type: 'end',
        data: { display_name: 'End' },
      },
    ]);
    expect(graph.edges).toEqual([
      {
        id: 'start-end',
        source: 'start',
        target: 'end',
        type: 'default',
      },
    ]);
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
      output_capture: 'last_message',
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

  it('keeps workflow edge semantics separate from React Flow edge renderer type', () => {
    const edge = createWorkflowEdge({
      id: 'review-approve',
      source: 'review',
      target: 'ship',
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
      type: 'smoothstep',
      data: { workflowType: 'approval' },
      label: 'Approve',
    });

    const graph = fromReactFlowGraph([], flowEdges);

    expect(graph.edges[0]).toEqual(edge);
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
