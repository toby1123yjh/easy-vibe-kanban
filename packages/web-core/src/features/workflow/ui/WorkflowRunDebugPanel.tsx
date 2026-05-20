import { cn } from '@/shared/lib/utils';
import type { WorkflowNodeDebugView } from '../model/workflowRunView';
import { useTranslation } from 'react-i18next';

export function WorkflowRunDebugPanel({
  debug,
}: {
  debug: WorkflowNodeDebugView | null;
}) {
  const { t } = useTranslation('common');
  if (!debug) {
    return (
      <div className="text-sm text-low">{t('workflow.debug.noDebugData')}</div>
    );
  }

  return (
    <div data-testid="workflow-node-debug-panel" className="space-y-base">
      <DebugBlock
        title={t('workflow.debug.runInput')}
        emptyLabel={t('workflow.debug.noRunInput')}
        value={debug.rawInput}
      />
      <DebugBlock
        title={t('workflow.debug.promptTemplate')}
        emptyLabel={t('workflow.debug.noPromptTemplate')}
        value={debug.promptTemplate}
      />
      <DebugBlock
        title={t('workflow.debug.renderedPrompt')}
        emptyLabel={t('workflow.debug.noRenderedPrompt')}
        value={debug.renderedPrompt}
      />
      <div>
        <h3 className="mb-half text-xs font-semibold uppercase text-low">
          {t('workflow.debug.upstreamOutputs')}
        </h3>
        <div className="space-y-half">
          {debug.upstreamOutputs.length === 0 ? (
            <p className="text-xs text-low">
              {t('workflow.debug.noUpstreamOutput')}
            </p>
          ) : (
            debug.upstreamOutputs.map((output) => (
              <DebugBlock
                key={output.nodeId}
                title={output.nodeId}
                value={output.outputText}
              />
            ))
          )}
        </div>
      </div>
      <DebugBlock
        title={t('workflow.dashboard.output')}
        emptyLabel={t('workflow.dashboard.noOutput')}
        value={debug.outputText}
      />
      {debug.errorText ? (
        <DebugBlock
          title={t('workflow.dashboard.error')}
          value={debug.errorText}
          tone="danger"
        />
      ) : null}
      <DebugBlock
        title={t('workflow.nodeSession.sessionId')}
        emptyLabel={t('workflow.debug.noSessionId')}
        value={debug.sessionId}
      />
      <DebugBlock
        title={t('workflow.nodeSession.processId')}
        emptyLabel={t('workflow.debug.noProcessId')}
        value={debug.executionProcessId}
      />
    </div>
  );
}

function DebugBlock({
  title,
  emptyLabel,
  value,
  tone = 'normal',
}: {
  title: string;
  emptyLabel?: string;
  value: string | null;
  tone?: 'normal' | 'danger';
}) {
  return (
    <div>
      <h3
        className={cn(
          'mb-half text-xs font-semibold uppercase',
          tone === 'danger' ? 'text-error' : 'text-low'
        )}
      >
        {title}
      </h3>
      <pre
        className={cn(
          'max-h-64 overflow-auto whitespace-pre-wrap rounded border p-half text-xs',
          tone === 'danger'
            ? 'border-error/50 bg-error/10 text-error'
            : 'border-secondary bg-primary text-high'
        )}
      >
        {value || emptyLabel || title}
      </pre>
    </div>
  );
}
