import { BaseCodingAgent, type ExecutorConfig } from 'shared/types';
import type { WorkflowNode, WorkflowNodeData } from './workflowGraph';

const BASE_CODING_AGENT_VALUES = new Set<BaseCodingAgent>(
  Object.values(BaseCodingAgent)
);

function coerceBaseCodingAgent(value: unknown): BaseCodingAgent | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().replaceAll('-', '_').toUpperCase();
  if (normalized === 'CURSOR') return BaseCodingAgent.CURSOR_AGENT;
  if (BASE_CODING_AGENT_VALUES.has(normalized as BaseCodingAgent)) {
    return normalized as BaseCodingAgent;
  }
  return null;
}

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
  const executor = coerceBaseCodingAgent(candidate.executor);
  if (!executor) return null;

  const config: ExecutorConfig = {
    executor,
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
  includeWorkflowContext,
}: {
  prompt: string;
  executorConfig: ExecutorConfig | null;
  includeWorkflowContext?: boolean;
}): Partial<WorkflowNodeData> {
  return {
    prompt_template: prompt,
    executor_config: executorConfig ?? undefined,
    ...(typeof includeWorkflowContext === 'boolean'
      ? { include_workflow_context: includeWorkflowContext }
      : {}),
  };
}
