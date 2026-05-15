import { BaseCodingAgent, type ExecutorConfig } from 'shared/types';
import type { WorkflowNode, WorkflowNodeData } from './workflowGraph';

const BASE_CODING_AGENT_VALUES = new Set<string>(
  Object.values(BaseCodingAgent)
);

export function isWorkflowAgentDraftNode(
  node: WorkflowNode | null
): node is WorkflowNode & { type: 'agent' } {
  return node?.type === 'agent';
}

export function coerceWorkflowNodeExecutorConfig(
  value: unknown
): ExecutorConfig | null {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.executor !== 'string' ||
    !BASE_CODING_AGENT_VALUES.has(candidate.executor)
  ) {
    return null;
  }

  const config: ExecutorConfig = {
    executor: candidate.executor as BaseCodingAgent,
    variant:
      typeof candidate.variant === 'string' || candidate.variant === null
        ? candidate.variant
        : null,
  };

  for (const key of [
    'model_id',
    'agent_id',
    'reasoning_id',
    'permission_policy',
  ] as const) {
    const value = candidate[key];
    if (value === null || typeof value === 'string') {
      config[key] = value as never;
    }
  }

  return config;
}

export function createWorkflowAgentNodeDraftPatch({
  prompt,
  executorConfig,
}: {
  prompt: string;
  executorConfig: ExecutorConfig | null;
}): Partial<WorkflowNodeData> {
  return {
    prompt_template: prompt,
    executor_config: executorConfig ?? undefined,
  };
}
