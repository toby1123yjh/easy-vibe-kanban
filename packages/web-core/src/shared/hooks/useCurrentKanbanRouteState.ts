import { useMemo } from 'react';
import { useCurrentAppDestination } from '@/shared/hooks/useCurrentAppDestination';
import {
  resolveKanbanRouteState,
  type KanbanRouteState,
} from '@/shared/lib/routes/appNavigation';
import {
  buildKanbanTaskComposerKey,
  useKanbanTaskComposer,
} from '@/shared/stores/useKanbanTaskComposerStore';

export function useCurrentKanbanRouteState(): KanbanRouteState {
  const destination = useCurrentAppDestination();
  const routeState = useMemo(
    () => resolveKanbanRouteState(destination),
    [destination]
  );
  const taskComposerKey = useMemo(() => {
    if (!routeState.projectId) {
      return null;
    }

    return buildKanbanTaskComposerKey(routeState.hostId, routeState.projectId);
  }, [routeState.hostId, routeState.projectId]);
  const taskComposer = useKanbanTaskComposer(taskComposerKey);
  const isCreateMode = taskComposer !== null;

  return useMemo(
    () => ({
      ...routeState,
      isCreateMode,
      isPanelOpen: routeState.isPanelOpen || isCreateMode,
    }),
    [routeState, isCreateMode]
  );
}
