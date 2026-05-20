import type { TFunction } from 'i18next';
import type {
  WorkflowGraphDefaultLabels,
  WorkflowNodeData,
  WorkflowNodeKind,
} from '../model/workflowGraph';

export function getWorkflowDefaultGraphLabels(
  t: TFunction<'common'>
): WorkflowGraphDefaultLabels {
  return {
    startLabel: t('workflow.nodes.start.label'),
    endLabel: t('workflow.nodes.end.label'),
    familiarizeLabel: t('workflow.defaultGraph.familiarizeLabel'),
    agentPrompt: t('workflow.defaultGraph.agentPrompt'),
    stageTitle: t('workflow.defaultGraph.stageTitle'),
    stageDescription: t('workflow.defaultGraph.stageDescription'),
  };
}

export function getWorkflowDefaultNodeData(
  kind: WorkflowNodeKind,
  t: TFunction<'common'>
): Partial<WorkflowNodeData> {
  switch (kind) {
    case 'start':
      return { display_name: t('workflow.nodes.start.label') };
    case 'end':
      return { display_name: t('workflow.nodes.end.label') };
    case 'agent':
      return { display_name: t('workflow.nodes.agent.label') };
    case 'condition':
      return { display_name: t('workflow.nodes.condition.label') };
    case 'human_gate':
      return { display_name: t('workflow.nodes.humanGate.label') };
    case 'transform':
      return { display_name: t('workflow.nodes.transform.label') };
    case 'arena':
      return {
        display_name: t('workflow.nodes.arena.label'),
        attempts: [
          {
            id: 'attempt-a',
            display_name: t('workflow.nodes.arena.attemptA'),
            role_template_id: 'custom',
            prompt_template: '',
          },
          {
            id: 'attempt-b',
            display_name: t('workflow.nodes.arena.attemptB'),
            role_template_id: 'custom',
            prompt_template: '',
          },
        ],
      };
  }
}

export function workflowNodeStatusKey(status: string): string {
  switch (status) {
    case 'awaiting_human':
      return 'awaitingHuman';
    case 'awaiting_arena':
      return 'awaitingArena';
    default:
      return status;
  }
}
