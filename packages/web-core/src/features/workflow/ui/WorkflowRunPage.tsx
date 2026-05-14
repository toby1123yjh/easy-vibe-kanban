import { useState } from 'react';
import { useWorkflowRun } from '@/shared/hooks/useWorkflowRun';
import { useWorkflowRunEvents } from '@/shared/hooks/useWorkflowRunEvents';
import {
  getWorkflowRunStatusLabel,
  getWorkflowRunTaskAttemptLabel,
} from '../model/workflowRunView';
import { WorkflowRunCanvasTab } from './WorkflowRunCanvasTab';
import { WorkflowRunDashboardTab } from './WorkflowRunDashboardTab';
import { Activity, LayoutDashboard, Workflow } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export interface WorkflowRunPageProps {
  projectId: string;
  runId: string;
}

export function WorkflowRunPage({ projectId, runId }: WorkflowRunPageProps) {
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
        Loading run...
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="flex h-full items-center justify-center text-error">
        Failed to load run {runId}
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
        <div className="flex min-w-0 items-center gap-base">
          <h1 className="max-w-[240px] truncate text-sm font-medium text-high sm:max-w-md">
            {getWorkflowRunTaskAttemptLabel(run)}
          </h1>
          <div
            className={cn(
              'rounded-full bg-secondary px-2 py-0.5 text-xs font-medium',
              statusTone
            )}
          >
            {getWorkflowRunStatusLabel(run.status)}
          </div>
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
            <span>Canvas</span>
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
            <span>Dashboard</span>
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
