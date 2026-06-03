import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_GRAPH_VERSION,
  createWorkflowEdge,
  createDefaultWorkflowGraph,
  type WorkflowGraph,
} from '../model/workflowGraph';
import { validateWorkflowGraph } from './WorkflowValidationPanel';

describe('workflow graph validation panel helpers', () => {
  it('accepts the current workflow graph version', () => {
    expect(
      validateWorkflowGraph(createDefaultWorkflowGraph())
    ).not.toContainEqual({
      type: 'error',
      message: 'Unsupported graph version',
    });
  });

  it('reports nodes that cannot be reached from Start', () => {
    const graph: WorkflowGraph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        { id: 'start', type: 'start', data: { display_name: 'Start' } },
        { id: 'agent', type: 'agent', data: { display_name: 'Agent' } },
        { id: 'end', type: 'end', data: { display_name: 'End' } },
      ],
      edges: [
        { id: 'start-end', source: 'start', target: 'end', type: 'default' },
      ],
    };

    expect(validateWorkflowGraph(graph)).toContainEqual({
      type: 'error',
      nodeId: 'agent',
      message: 'Unreachable node: agent',
    });
  });

  it('reports cycles before the graph is saved', () => {
    const graph: WorkflowGraph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        { id: 'start', type: 'start', data: { display_name: 'Start' } },
        { id: 'agent', type: 'agent', data: { display_name: 'Agent' } },
        { id: 'end', type: 'end', data: { display_name: 'End' } },
      ],
      edges: [
        {
          id: 'start-agent',
          source: 'start',
          target: 'agent',
          type: 'default',
        },
        {
          id: 'agent-start',
          source: 'agent',
          target: 'start',
          type: 'default',
        },
        { id: 'agent-end', source: 'agent', target: 'end', type: 'default' },
      ],
    };

    expect(validateWorkflowGraph(graph)).toContainEqual({
      type: 'error',
      nodeId: 'start',
      message: 'Workflow contains a cycle at start',
    });
  });

  it('attaches node ids to edge validation issues when possible', () => {
    const graph: WorkflowGraph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        { id: 'start', type: 'start', data: { display_name: 'Start' } },
        { id: 'end', type: 'end', data: { display_name: 'End' } },
      ],
      edges: [
        {
          id: 'start-start',
          source: 'start',
          target: 'start',
          type: 'default',
        },
      ],
    };

    expect(validateWorkflowGraph(graph)).toContainEqual({
      type: 'error',
      nodeId: 'start',
      message: 'Self-edge found on node start',
    });
  });

  it('allows incomplete agentic condition configuration while drafting', () => {
    const graph: WorkflowGraph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        { id: 'start', type: 'start', data: { display_name: 'Start' } },
        {
          id: 'condition',
          type: 'condition',
          data: {
            display_name: 'Condition',
            routing_mode: 'single',
            branches: [{ target_node_id: 'end', condition: '' }],
          },
        },
        { id: 'end', type: 'end', data: { display_name: 'End' } },
      ],
      edges: [
        createWorkflowEdge({
          id: 'start-condition',
          source: 'start',
          target: 'condition',
        }),
        createWorkflowEdge({
          id: 'condition-end',
          source: 'condition',
          target: 'end',
          type: 'condition_branch',
        }),
      ],
    };

    expect(
      validateWorkflowGraph(graph, { includeRunReadiness: false })
    ).toEqual([]);
  });

  it('requires workflow-level router config before running condition nodes', () => {
    const graph: WorkflowGraph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        { id: 'start', type: 'start', data: { display_name: 'Start' } },
        {
          id: 'condition',
          type: 'condition',
          data: {
            display_name: 'Condition',
            routing_mode: 'single',
            branches: [
              { target_node_id: 'end', condition: 'Nothing else is needed' },
            ],
          },
        },
        { id: 'end', type: 'end', data: { display_name: 'End' } },
      ],
      edges: [
        createWorkflowEdge({
          id: 'start-condition',
          source: 'start',
          target: 'condition',
        }),
        createWorkflowEdge({
          id: 'condition-end',
          source: 'condition',
          target: 'end',
          type: 'condition_branch',
        }),
      ],
    };

    expect(validateWorkflowGraph(graph)).toContainEqual({
      type: 'error',
      message: 'Workflow with Condition nodes requires a router agent',
    });

    expect(
      validateWorkflowGraph({
        ...graph,
        router_executor_config: { executor: ' ' },
      })
    ).toContainEqual({
      type: 'error',
      message: 'Workflow with Condition nodes requires a router agent',
    });

    expect(
      validateWorkflowGraph({
        ...graph,
        router_executor_config: { executor: 'unknown' },
      })
    ).toContainEqual({
      type: 'error',
      message: 'Workflow with Condition nodes requires a router agent',
    });

    expect(
      validateWorkflowGraph({
        ...graph,
        router_executor_config: { executor: 'codex' },
      })
    ).not.toContainEqual({
      type: 'error',
      message: 'Workflow with Condition nodes requires a router agent',
    });

    expect(
      validateWorkflowGraph({
        ...graph,
        router_executor_config: { executor: 'codex' },
      })
    ).toContainEqual({
      type: 'error',
      message: 'Agentic Condition router runtime is not implemented yet',
    });
  });

  it('rejects invalid condition branch configuration before run', () => {
    const baseNodes: WorkflowGraph['nodes'] = [
      { id: 'start', type: 'start', data: { display_name: 'Start' } },
      { id: 'end', type: 'end', data: { display_name: 'End' } },
    ];
    const baseEdges: WorkflowGraph['edges'] = [
      createWorkflowEdge({
        id: 'start-condition',
        source: 'start',
        target: 'condition',
      }),
      createWorkflowEdge({
        id: 'condition-end',
        source: 'condition',
        target: 'end',
        type: 'condition_branch',
      }),
    ];
    const makeGraph = (
      branches: NonNullable<WorkflowGraph['nodes'][number]['data']['branches']>
    ): WorkflowGraph => ({
      version: WORKFLOW_GRAPH_VERSION,
      router_executor_config: { executor: 'codex' },
      nodes: [
        baseNodes[0],
        {
          id: 'condition',
          type: 'condition',
          data: {
            display_name: 'Condition',
            routing_mode: 'single',
            branches,
          },
        },
        baseNodes[1],
      ],
      edges: baseEdges,
    });

    expect(validateWorkflowGraph(makeGraph([]))).toContainEqual({
      type: 'error',
      nodeId: 'condition',
      message: 'Condition node condition is missing branch config for end',
    });
    expect(
      validateWorkflowGraph(
        makeGraph([{ target_node_id: 'missing', condition: 'Use missing' }])
      )
    ).toContainEqual({
      type: 'error',
      nodeId: 'condition',
      message: 'Condition node condition has stale branch target: missing',
    });
    expect(
      validateWorkflowGraph(
        makeGraph([
          { target_node_id: 'end', condition: 'First' },
          { target_node_id: 'end', condition: 'Second' },
        ])
      )
    ).toContainEqual({
      type: 'error',
      nodeId: 'condition',
      message: 'Condition node condition has duplicate branch target: end',
    });
    expect(
      validateWorkflowGraph(
        makeGraph([{ target_node_id: 'end', condition: ' ' }])
      )
    ).toContainEqual({
      type: 'error',
      nodeId: 'condition',
      message: 'Condition node condition has empty branch condition for end',
    });
  });

  it('rejects duplicate outgoing condition targets structurally', () => {
    const graph: WorkflowGraph = {
      version: WORKFLOW_GRAPH_VERSION,
      nodes: [
        { id: 'start', type: 'start', data: { display_name: 'Start' } },
        {
          id: 'condition',
          type: 'condition',
          data: { display_name: 'Condition', branches: [] },
        },
        { id: 'end', type: 'end', data: { display_name: 'End' } },
      ],
      edges: [
        createWorkflowEdge({
          id: 'start-condition',
          source: 'start',
          target: 'condition',
        }),
        createWorkflowEdge({
          id: 'condition-end-a',
          source: 'condition',
          target: 'end',
          type: 'condition_branch',
        }),
        createWorkflowEdge({
          id: 'condition-end-b',
          source: 'condition',
          target: 'end',
          type: 'condition_branch',
        }),
      ],
    };

    expect(
      validateWorkflowGraph(graph, { includeRunReadiness: false })
    ).toContainEqual({
      type: 'error',
      nodeId: 'condition',
      message: 'Condition node condition has duplicate outgoing target: end',
    });
  });
});
