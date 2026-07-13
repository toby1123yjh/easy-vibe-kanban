import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWorkflowRun } from '@/shared/hooks/useWorkflowRun';
import { useWorkflowRunEvents } from '@/shared/hooks/useWorkflowRunEvents';
import { WorkflowRunCanvasTab } from './WorkflowRunCanvasTab';
import { WorkflowRunDashboardTab } from './WorkflowRunDashboardTab';
import { Activity, LayoutDashboard, Workflow } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { WorkspaceContextHeader } from '@/shared/components/WorkspaceContextHeader';

export interface WorkflowRunPageProps {
  projectId: string;
  runId: string;
}

export function WorkflowRunPage({ projectId, runId }: WorkflowRunPageProps) {
  const { t } = useTranslation('common');
  const { data: run, isLoading, error } = useWorkflowRun(runId);
  const [activeTab, setActiveTab] = useState<'canvas' | 'dashboard'>('canvas');
  const shouldStreamEvents =
    !!run &&
    (run.status === 'pending' ||
      run.status === 'running' ||
      run.status === 'awaiting_human' ||
      run.status === 'awaiting_arena');

  useWorkflowRunEvents(runId, {
    enabled: shouldStreamEvents,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-low">
        <Activity className="mr-2 h-4 w-4 animate-spin" />
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

  const statusTone =
    run.status === 'succeeded'
      ? 'text-success'
      : run.status === 'failed' || run.status === 'canceled'
        ? 'text-error'
        : run.status === 'awaiting_human' || run.status === 'awaiting_arena'
          ? 'text-warning'
          : 'text-high';

  return (
    <div className="flex h-full flex-col bg-primary">
      <header className="flex flex-none flex-col gap-half border-b border-secondary bg-panel px-base py-half sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-half">
          <div className="flex min-w-0 items-center gap-base">
            <h1 className="max-w-[240px] truncate text-sm font-medium text-high sm:max-w-md">
              {run.attempt_id
                ? t('workflow.runPage.taskAttempt', {
                    id: run.attempt_id.slice(0, 9),
                  })
                : t('workflow.runPage.workflowRun', {
                    id: run.id.slice(0, 8),
                  })}
            </h1>
            <div
              className={cn(
                'rounded-full bg-secondary px-2 py-0.5 text-xs font-medium',
                statusTone
              )}
            >
              {t(`workflow.runStatus.${statusKey(run.status)}`)}
            </div>
          </div>
          <WorkspaceContextHeader
            workspaceId={run.workspace_id}
            className="max-w-[720px]"
          />
        </div>

        <div className="flex w-full items-center rounded bg-secondary p-1 sm:w-auto">
          <button
            type="button"
            onClick={() => setActiveTab('canvas')}
            className={cn(
              'flex min-h-9 flex-1 items-center justify-center gap-half rounded px-3 py-1 text-xs font-medium transition-colors sm:flex-none',
              activeTab === 'canvas'
                ? 'bg-primary text-high shadow-sm'
                : 'text-low hover:text-high'
            )}
          >
            <Workflow className="h-3 w-3" />
            <span>{t('workflow.runPage.canvas')}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={cn(
              'flex min-h-9 flex-1 items-center justify-center gap-half rounded px-3 py-1 text-xs font-medium transition-colors sm:flex-none',
              activeTab === 'dashboard'
                ? 'bg-primary text-high shadow-sm'
                : 'text-low hover:text-high'
            )}
          >
            <LayoutDashboard className="h-3 w-3" />
            <span>{t('workflow.runPage.dashboard')}</span>
          </button>
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        {activeTab === 'canvas' && (
          <WorkflowRunCanvasTab projectId={projectId} run={run} />
        )}
        {activeTab === 'dashboard' && (
          <WorkflowRunDashboardTab projectId={projectId} run={run} />
        )}
      </main>
    </div>
  );
}

function statusKey(status: string): string {
  switch (status) {
    case 'awaiting_human':
      return 'awaitingHuman';
    case 'awaiting_arena':
      return 'awaitingArena';
    default:
      return status;
  }
}
