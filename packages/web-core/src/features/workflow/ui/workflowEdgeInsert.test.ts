import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCE_HANDLE,
  DEFAULT_TARGET_HANDLE,
} from '../model/workflowGraph';
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
    expect(result[0]).toMatchObject({
      sourceHandle: DEFAULT_SOURCE_HANDLE,
      targetHandle: DEFAULT_TARGET_HANDLE,
    });
    expect(result[1]).toMatchObject({
      sourceHandle: DEFAULT_SOURCE_HANDLE,
      targetHandle: DEFAULT_TARGET_HANDLE,
    });
  });
});
