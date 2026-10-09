import { useCallback } from 'react';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useAppRuntime } from '@/shared/hooks/useAppRuntime';
import { useCurrentKanbanRouteState } from '@/shared/hooks/useCurrentKanbanRouteState';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import type { CreateModeInitialState } from '@/shared/types/createMode';
import { persistWorkspaceCreateDraft } from '@/shared/lib/workspaceCreateState';

export function useProjectWorkspaceCreateDraft() {
  const { projectId } = useProjectContext();
  const appNavigation = useAppNavigation();
  const routeState = useCurrentKanbanRouteState();
  const runtime = useAppRuntime();

  const openWorkspaceCreateFromState = useCallback(
    async (
      initialState: CreateModeInitialState,
      options?: { taskId?: string | null }
    ): Promise<string | null> => {
      if (!projectId) return null;

      const draftId = await persistWorkspaceCreateDraft(
        initialState,
        crypto.randomUUID(),
        runtime
      );
      if (!draftId) {
        return null;
      }

      const taskId =
        options?.taskId ??
        initialState.linkedTask?.taskId ??
        routeState.taskId ??
        null;
      if (taskId) {
        appNavigation.goToProjectTaskWorkspaceCreate(
          projectId,
          taskId,
          draftId
        );
      } else {
        appNavigation.goToProjectWorkspaceCreate(projectId, draftId);
      }

      return draftId;
    },
    [projectId, appNavigation, routeState.taskId, runtime]
  );

  return {
    openWorkspaceCreateFromState,
  };
}
