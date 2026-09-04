import { describe, expect, it } from 'vitest';
import { BaseCodingAgent } from 'shared/types';
import type { WorkflowNode } from './workflowGraph';
import {
  coerceWorkflowNodeExecutorConfig,
  isWorkflowAgentDraftNode,
} from './workflowAgentNodeDraft';

describe('workflow agent node draft sessions', () => {
  it('treats agent nodes as editable session drafts before a run exists', () => {
    const node: WorkflowNode = {
      id: 'agent-1',
      type: 'agent',
      data: { display_name: 'Research code' },
    };

    expect(isWorkflowAgentDraftNode(node)).toBe(true);
    expect(isWorkflowAgentDraftNode({ ...node, type: 'condition' })).toBe(
      false
    );
  });

  it('accepts stored executor config values only when they identify a valid agent', () => {
    expect(
      coerceWorkflowNodeExecutorConfig({
        executor: BaseCodingAgent.CLAUDE_CODE,
        variant: null,
      })
    ).toEqual({
      executor: BaseCodingAgent.CLAUDE_CODE,
      variant: null,
    });

    expect(
      coerceWorkflowNodeExecutorConfig({
        executor: 'claude-code',
        variant: null,
      })
    ).toEqual({
      executor: BaseCodingAgent.CLAUDE_CODE,
      variant: null,
    });

    expect(coerceWorkflowNodeExecutorConfig({ executor: 'CURSOR' })).toBe(null);

    expect(coerceWorkflowNodeExecutorConfig({ executor: 'not-real' })).toBe(
      null
    );
  });
});
