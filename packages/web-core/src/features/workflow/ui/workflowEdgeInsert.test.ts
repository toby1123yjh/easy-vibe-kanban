import { describe, expect, it } from 'vitest';
import { splitWorkflowEdgeForInsertedNode } from './workflowEdgeInsert';

describe('splitWorkflowEdgeForInsertedNode', () => {
  it('splits an existing edge around the inserted node', () => {
    const result = splitWorkflowEdgeForInsertedNode({
      edge: {
        id: 'start-end',
        source: 'start',
        sourceHandle: 'output-right',
        target: 'end',
        targetHandle: 'input-left',
        type: 'workflow',
        data: { workflowType: 'default' },
      },
      nodeId: 'agent-1',
    });

    expect(result.map((edge) => edge.id)).toEqual([
      'start-agent-1',
      'agent-1-end',
    ]);
  });
});
