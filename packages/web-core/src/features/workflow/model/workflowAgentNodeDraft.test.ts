import { describe, expect, it } from 'vitest';
import {
  BaseCodingAgent,
  type ExecutorConfig,
  type SelectedSkill,
} from 'shared/types';
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

  it('persists the workflow context setting when provided', () => {
    expect(
      createWorkflowAgentNodeDraftPatch({
        prompt: 'Run exactly this prompt',
        executorConfig: null,
        includeWorkflowContext: false,
      })
    ).toEqual({
      prompt_template: 'Run exactly this prompt',
      executor_config: undefined,
      include_workflow_context: false,
    });
  });

  it('persists selected skills and omits empty skill selections', () => {
    const selectedSkills: SelectedSkill[] = [
      {
        name: 'trellis-before-dev',
        path: 'C:/skills/trellis-before-dev/SKILL.md',
      },
    ];

    expect(
      createWorkflowAgentNodeDraftPatch({
        prompt: 'Use the selected skill',
        executorConfig: null,
        selectedSkills,
      })
    ).toEqual({
      prompt_template: 'Use the selected skill',
      executor_config: undefined,
      selected_skills: selectedSkills,
    });

    expect(
      createWorkflowAgentNodeDraftPatch({
        prompt: 'No selected skill',
        executorConfig: null,
        selectedSkills: [],
      })
    ).toEqual({
      prompt_template: 'No selected skill',
      executor_config: undefined,
      selected_skills: undefined,
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
