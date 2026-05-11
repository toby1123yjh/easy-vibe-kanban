import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_GRAPH_VERSION,
  type WorkflowGraph,
} from '../model/workflowGraph';
import { validateWorkflowGraph } from './WorkflowValidationPanel';

describe('workflow graph validation panel helpers', () => {
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
});
