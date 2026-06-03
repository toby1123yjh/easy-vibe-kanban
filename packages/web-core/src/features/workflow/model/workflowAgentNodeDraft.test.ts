import { describe, expect, it } from 'vitest';
import { BaseCodingAgent, type ExecutorConfig } from 'shared/types';
import type { WorkflowNode } from './workflowGraph';
import {
  coerceWorkflowNodeExecutorConfig,
  createWorkflowAgentNodeDraftPatch,
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

  it('persists the task prompt and selected agent on the node data', () => {
    const executorConfig: ExecutorConfig = {
      executor: BaseCodingAgent.CODEX,
      variant: 'DEFAULT',
      model_id: 'gpt-5.4',
    };

    expect(
      createWorkflowAgentNodeDraftPatch({
        prompt: 'Audit current project modules',
        executorConfig,
      })
    ).toEqual({
      prompt_template: 'Audit current project modules',
      executor_config: executorConfig,
    });
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

    expect(coerceWorkflowNodeExecutorConfig({ executor: 'CURSOR' })).toEqual({
      executor: BaseCodingAgent.CURSOR_AGENT,
      variant: null,
    });

    expect(coerceWorkflowNodeExecutorConfig({ executor: 'not-real' })).toBe(
      null
    );
  });
});
