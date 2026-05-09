import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_GRAPH_VERSION,
  createDefaultWorkflowGraph,
  createWorkflowNode,
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
      branches: [{ name: 'Matched' }, { name: 'Fallback' }],
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
});
