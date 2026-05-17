import type { BaseCodingAgent, ExecutorConfig } from 'shared/types';
import { toPrettyCase } from '@/shared/lib/string';
import type { WorkflowNodeData } from './workflowGraph';
import { coerceWorkflowNodeExecutorConfig } from './workflowAgentNodeDraft';

export interface WorkflowAgentDisplay {
  executor: BaseCodingAgent | null;
  executorConfig: ExecutorConfig | null;
  agentLabel: string;
  modelLabel: string;
  detailLabel: string;
  reasoningLabel: string | null;
}

function formatOptionalLabel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function getWorkflowAgentDisplay(
  data: Pick<WorkflowNodeData, 'executor_config'>
): WorkflowAgentDisplay {
  const executorConfig = coerceWorkflowNodeExecutorConfig(data.executor_config);
  const agentLabel = executorConfig
    ? toPrettyCase(executorConfig.executor)
    : 'Default agent';
  const configuredModel =
    formatOptionalLabel(executorConfig?.model_id) ??
    formatOptionalLabel(executorConfig?.agent_id);
  const configuredVariant = formatOptionalLabel(executorConfig?.variant);
  const modelLabel =
    configuredModel ??
    (configuredVariant && configuredVariant !== 'DEFAULT'
      ? configuredVariant
      : 'Default model');
  const reasoningLabel = formatOptionalLabel(executorConfig?.reasoning_id);

  return {
    executor: executorConfig?.executor ?? null,
    executorConfig,
    agentLabel,
    modelLabel,
    detailLabel: `${agentLabel} / ${modelLabel}`,
    reasoningLabel,
  };
}
