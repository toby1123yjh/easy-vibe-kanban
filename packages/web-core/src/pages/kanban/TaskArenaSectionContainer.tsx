import { useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Sparkles } from 'lucide-react';
import {
  arenaQueryKeys,
  useActiveArenaForTask,
} from '@/shared/hooks/useArenaGroup';
import { CreateArenaDialog } from '@/features/arena';
import { arenaApi, isActiveArenaAgentRunStatus } from '@/shared/lib/arenaApi';
import { useCurrentKanbanRouteState } from '@/shared/hooks/useCurrentKanbanRouteState';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';

interface TaskArenaSectionContainerProps {
  taskId: string;
  /** Suggested initial prompt for the new Arena. */
  initialPrompt?: string;
}

/** Compact Arena entry point for the Kanban issue panel. */
export function TaskArenaSectionContainer({
  taskId,
  initialPrompt,
}: TaskArenaSectionContainerProps) {
  const { projectId } = useParams({ strict: false });
  const appNavigation = useAppNavigation();
  const queryClient = useQueryClient();
  const { t } = useTranslation('common');
  const routeState = useCurrentKanbanRouteState();

  const {
    data: activeArena,
    isLoading,
    refetch,
  } = useActiveArenaForTask(taskId);

  if (!projectId) return null;

  const goToArena = (groupId: string) => {
    appNavigation.goToProjectTaskArena?.(projectId, taskId, groupId);
  };

  const handleStart = async () => {
    const latestArena = await refetch();
    if (latestArena.data) {
      if (latestArena.data.workspaces.length > 0) {
        goToArena(latestArena.data.id);
        return;
      }

      try {
        await arenaApi.dissolve(latestArena.data.id);
        await queryClient.invalidateQueries({
          queryKey: arenaQueryKeys.activeForTask(taskId),
        });
      } catch (error) {
        console.warn('[IssueArenaSection] Failed to clear empty Arena:', error);
        goToArena(latestArena.data.id);
        return;
      }
    }

    const result = await CreateArenaDialog.show({
      projectId,
      taskId,
      hostId: routeState.hostId,
      initialPrompt,
    });
    if (result.kind === 'created') {
      await queryClient.invalidateQueries({
        queryKey: arenaQueryKeys.activeForTask(taskId),
      });
      goToArena(result.groupId);
    }
  };

  if (isLoading) {
    return null;
  }

  if (activeArena && activeArena.workspaces.length > 0) {
    const total = activeArena.workspaces.length;
    const running = activeArena.workspaces.filter((ws) =>
      isActiveArenaAgentRunStatus(ws.latest_agent_run_status)
    ).length;
    const modeLabel =
      activeArena.mode === 'design'
        ? t('arena.modes.design')
        : t('arena.modes.implementation');
    return (
      <div className="my-half">
        <button
          type="button"
          onClick={() => goToArena(activeArena.id)}
          className="group flex w-full items-center gap-base rounded-sm border border-brand/35 bg-brand/5 px-base py-half text-left text-sm transition-colors hover:bg-brand/10"
          aria-label={t('arena.aria.openArena')}
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-brand/10 text-brand">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium text-high">
              {t('arena.title')}
            </span>
            <span className="block truncate text-xs text-low">
              {t('arena.issueSection.activeSummary', {
                mode: modeLabel,
                total,
                running,
              })}
            </span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-low group-hover:text-high">
            {t('arena.actions.open')}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="my-half">
      <button
        type="button"
        onClick={() => void handleStart()}
        className="group flex w-full items-center gap-base rounded-sm border border-brand/25 bg-secondary/60 px-base py-half text-left text-sm transition-colors hover:border-brand/40 hover:bg-brand/5"
        aria-label={t('arena.aria.startArena')}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-brand/10 text-brand">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-high">
            {t('arena.title')}
          </span>
          <span className="block truncate text-xs text-low">
            {t('arena.issueSection.startSubtitle')}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-low group-hover:text-high">
          {t('arena.actions.startArena')}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </button>
    </div>
  );
}
