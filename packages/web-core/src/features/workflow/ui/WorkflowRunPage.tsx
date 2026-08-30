import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { Button } from '@vibe/ui/components/Button';
import { WorkspaceContextHeader } from '@/shared/components/WorkspaceContextHeader';
import {
  useWorkflowRun,
  useWorkflowRunMutations,
} from '@/shared/hooks/useWorkflowRun';
import { useWorkflowRunEvents } from '@/shared/hooks/useWorkflowRunEvents';
import { useWorkflowTemplate } from '@/shared/hooks/useWorkflowTemplates';
import { cn } from '@/shared/lib/utils';
import {
  getWorkflowRunActionGate,
  getWorkflowRuntimeView,
} from '../model/workflowRuntimeView';
import { workflowNodeStatusKey } from './workflowI18n';
import { WorkflowRunCanvasTab } from './WorkflowRunCanvasTab';

export interface WorkflowRunPageProps {
  projectId: string;
  runId: string;
}

type CancelSubmissionState = 'idle' | 'submitting' | 'awaiting-projection';

export function WorkflowRunPage({ projectId, runId }: WorkflowRunPageProps) {
  const { t } = useTranslation('common');
  const { data: run, isLoading, error } = useWorkflowRun(runId);
  const { data: template } = useWorkflowTemplate(run?.workflow_id, {
    enabled: Boolean(run?.workflow_id),
  });
  const { cancelRun, isCanceling } = useWorkflowRunMutations();
  const cancelLockRef = useRef(false);
  const [cancelState, setCancelState] = useState<CancelSubmissionState>('idle');
  const [cancelError, setCancelError] = useState<string | null>(null);
  const shouldStreamEvents =
    !!run &&
    (run.status === 'pending' ||
      run.status === 'running' ||
      run.status === 'awaiting_human' ||
      run.status === 'awaiting_arena' ||
      run.status === 'cancelling');

  useWorkflowRunEvents(runId, {
    enabled: shouldStreamEvents,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-low">
        <Activity className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
        {t('workflow.runPage.loadingRun')}
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="flex h-full items-center justify-center text-error">
        {t('workflow.runPage.loadFailed', { runId })}
      </div>
    );
  }

  const runtimeView = getWorkflowRuntimeView(run);
  const runActionGate = getWorkflowRunActionGate(run);
  const cancelPending =
    runActionGate.cancellationPending ||
    (runActionGate.canCancel && (isCanceling || cancelState !== 'idle'));
  const showCancel =
    runActionGate.canCancel || runActionGate.cancellationPending;
  const totalNodes = runtimeView.node_work.length;
  const statusTone =
    run.status === 'succeeded'
      ? 'text-success'
      : run.status === 'failed' || run.status === 'canceled'
        ? 'text-error'
        : run.status === 'awaiting_human' || run.status === 'awaiting_arena'
          ? 'text-warning'
          : 'text-high';

  const handleCancel = async () => {
    if (cancelLockRef.current || cancelState !== 'idle') return;
    if (!getWorkflowRunActionGate(run).canCancel) return;

    cancelLockRef.current = true;
    setCancelState('submitting');
    setCancelError(null);
    try {
      await cancelRun(run.id);
      setCancelState('awaiting-projection');
    } catch (cancelRunError) {
      setCancelState('idle');
      setCancelError(
        cancelRunError instanceof Error
          ? cancelRunError.message
          : t('workflow.dashboard.cancelFailed')
      );
    } finally {
      cancelLockRef.current = false;
    }
  };

  return (
    <div className="flex h-full flex-col bg-primary">
      <header className="flex flex-none flex-col gap-half border-b border-secondary bg-panel px-base py-half sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-half">
          <div className="flex min-w-0 flex-wrap items-center gap-base">
            <h1 className="max-w-[320px] truncate text-sm font-medium text-high sm:max-w-lg">
              {template?.name ||
                t('workflow.runPage.workflowRun', {
                  id: run.id.slice(0, 8),
                })}
            </h1>
            <span
              className={cn(
                'rounded-full bg-secondary px-2 py-0.5 text-xs font-medium',
                statusTone
              )}
              aria-live="polite"
            >
              {t(`workflow.runStatus.${workflowNodeStatusKey(run.status)}`)}
            </span>
            <span className="text-xs text-low">
              {t('workflow.runPage.progress', {
                completed: runtimeView.completed_node_count,
                total: totalNodes,
              })}
            </span>
          </div>
          <WorkspaceContextHeader
            workspaceId={run.workspace_id}
            className="max-w-[720px]"
          />
          {cancelError ? (
            <p className="text-xs text-error" role="alert">
              {cancelError}
            </p>
          ) : null}
        </div>

        {showCancel ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={cancelPending || !runActionGate.canCancel}
            aria-busy={cancelPending}
            onClick={() => void handleCancel()}
          >
            {cancelPending
              ? t('workflow.runPage.cancelling')
              : t('workflow.dashboard.cancelRun')}
          </Button>
        ) : null}
      </header>

      <main className="relative min-h-0 flex-1">
        <WorkflowRunCanvasTab projectId={projectId} run={run} />
      </main>
    </div>
  );
}
