import { describe, expect, it } from 'vitest';
import {
  getConditionRouterHumanPrompt,
  getConditionRouterReason,
  getConditionRouterSelectedTargetIds,
  getConditionRouterSkippedTargetIds,
  parseConditionRouterOutput,
} from './workflowConditionRouterOutput';

describe('workflow condition router output helpers', () => {
  it('projects an awaiting-human router payload into readable fields', () => {
    const output = parseConditionRouterOutput(
      JSON.stringify({
        type: 'condition_router_decision',
        source: 'router',
        status: 'awaiting_human',
        schema_version: 1,
        decision: {
          schema_version: 1,
          status: 'needs_user',
          selected_target_node_ids: [],
          skipped_target_node_ids: ['frontend', 'backend'],
          confidence: 'low',
          reason: 'Input only says "开发".',
          question: '请明确这是前端开发任务还是后端开发任务？',
        },
        raw_output: '<workflow_router_decision>{}</workflow_router_decision>',
        selected_target_node_ids: [],
        skipped_target_node_ids: [],
        validation: {
          result: 'pause',
          reason: '请明确这是前端开发任务还是后端开发任务？',
        },
      })
    );

    expect(output?.status).toBe('awaiting_human');
    expect(getConditionRouterHumanPrompt(output)).toBe(
      '请明确这是前端开发任务还是后端开发任务？'
    );
    expect(getConditionRouterReason(output)).toBe('Input only says "开发".');
    expect(getConditionRouterSelectedTargetIds(output)).toEqual([]);
    expect(getConditionRouterSkippedTargetIds(output)).toEqual([
      'frontend',
      'backend',
    ]);
  });

  it('returns null for ordinary agent output', () => {
    expect(parseConditionRouterOutput('plain text')).toBeNull();
    expect(parseConditionRouterOutput('{"type":"other"}')).toBeNull();
  });
});
