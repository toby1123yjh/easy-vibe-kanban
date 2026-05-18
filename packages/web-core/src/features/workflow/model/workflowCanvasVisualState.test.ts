import { describe, expect, it } from 'vitest';
import type { WorkflowNodeExecutionResponse } from 'shared/types';
import type { WorkflowGraph } from './workflowGraph';
import {
  buildWorkflowEdgeStateMap,
  buildWorkflowNodeExecutionStatusMap,
  getWorkflowCanvasEdgeState,
  getWorkflowCanvasNodeState,
  getWorkflowCanvasNodeStateLabel,
} from './workflowCanvasVisualState';

function execution(
  nodeId: string,
  status: WorkflowNodeExecutionResponse['status'],
  iteration = 0n
): WorkflowNodeExecutionResponse {
  return {
    id: `${nodeId}-${String(iteration)}`,
    run_id: 'run-1',
    node_id: nodeId,
    node_type: 'agent',
    iteration,
    status,
    input_text: null,
    output_text: null,
    session_id: null,
    execution_process_id: null,
    arena_group_id: null,
    tokens_used: null,
    cost_estimate: null,
    started_at: null,
    finished_at: null,
    error_text: null,
    created_at: '2026-05-18T00:00:00Z',
    updated_at: `2026-05-18T00:00:0${String(iteration)}Z`,
  };
}

const graph = {
  version: 2,
  nodes: [
    { id: 'start', type: 'start', data: { display_name: 'Start' } },
    {
      id: 'agent',
      type: 'agent',
      data: {
        display_name: 'Familiarize',
        prompt_template: 'Read the project',
      },
    },
    { id: 'end', type: 'end', data: { display_name: 'End' } },
  ],
  edges: [
    { id: 'start-agent', source: 'start', target: 'agent', type: 'default' },
    { id: 'agent-end', source: 'agent', target: 'end', type: 'default' },
  ],
} satisfies WorkflowGraph;

describe('workflow canvas visual state', () => {
  it('keeps idle edges quiet until the source node is running', () => {
    expect(getWorkflowCanvasEdgeState(undefined)).toBe('idle');
    expect(getWorkflowCanvasEdgeState('pending')).toBe('idle');
    expect(getWorkflowCanvasEdgeState('running')).toBe('running');
    expect(getWorkflowCanvasEdgeState('succeeded')).toBe('succeeded');
    expect(getWorkflowCanvasEdgeState('awaiting_human')).toBe('waiting');
    expect(getWorkflowCanvasEdgeState('failed')).toBe('failed');
  });

  it('maps latest node executions into canvas edge states', () => {
    const statuses = buildWorkflowNodeExecutionStatusMap([
      execution('agent', 'pending', 0n),
      execution('agent', 'running', 1n),
      execution('start', 'succeeded', 0n),
    ]);

    expect(statuses).toEqual({
      agent: 'running',
      start: 'succeeded',
    });
    expect(buildWorkflowEdgeStateMap(graph, statuses)).toEqual({
      'start-agent': 'succeeded',
      'agent-end': 'running',
    });
  });

  it('distinguishes draft, configured, and runtime node states', () => {
    expect(
      getWorkflowCanvasNodeState({
        nodeType: 'agent',
        data: {},
      })
    ).toBe('draft');
    expect(
      getWorkflowCanvasNodeState({
        nodeType: 'agent',
        data: { prompt_template: 'Read the project' },
      })
    ).toBe('configured');
    expect(
      getWorkflowCanvasNodeState({
        nodeType: 'agent',
        data: { prompt_template: 'Read the project' },
        executionStatus: 'failed',
      })
    ).toBe('failed');
    expect(getWorkflowCanvasNodeStateLabel('waiting')).toBe('Waiting');
  });
});
