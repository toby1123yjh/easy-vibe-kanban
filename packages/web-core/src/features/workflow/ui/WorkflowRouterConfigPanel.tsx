import { useTranslation } from 'react-i18next';
import type { ExecutorConfig } from 'shared/types';
import { WorkflowAgentExecutorField } from './WorkflowAgentExecutorField';

export interface WorkflowRouterConfigPanelProps {
  routerExecutorConfig?: unknown;
  readOnly?: boolean;
  error?: string | null;
  onChange: (executorConfig: ExecutorConfig) => void;
}

export function WorkflowRouterConfigPanel({
  routerExecutorConfig,
  readOnly = false,
  error,
  onChange,
}: WorkflowRouterConfigPanelProps) {
  const { t } = useTranslation('common');

  return (
    <div className="flex min-h-full flex-col gap-4 bg-panel/50 p-5 text-sm">
      <p className="text-xs leading-relaxed text-low">
        {t('workflow.router.description', {
          defaultValue:
            'Select the Agent that evaluates Condition branches for this workflow.',
        })}
      </p>
      <WorkflowAgentExecutorField
        value={routerExecutorConfig}
        readOnly={readOnly}
        onChange={onChange}
      />
      {error ? (
        <div
          role="alert"
          className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
