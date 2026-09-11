import {
  useCallback,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { sessionsApi } from '@/shared/lib/api';
import { executionDataApi } from '@/shared/lib/executionDataApi';
import { getHostRequestScopeQueryKey } from '@/shared/lib/hostRequestScope';
import { DeleteTaskSessionDialog } from '@/shared/dialogs/tasks/DeleteTaskSessionDialog';
import { workspaceSessionKeys } from './workspaceSessionKeys';
import { useAppShellProjects } from './useAppShellProjects';

export interface TaskSessionDeleteTarget {
  sessionId: string;
  workspaceId: string;
  title: string;
  /** Project actions require this exact Task; discovery rows resolve afresh. */
  taskId?: string;
}

interface DeleteTaskSessionOptions {
  hostId: string | null;
  /** Include the current Host, route, project and selected session identity. */
  scopeKey: string;
  discoveryScopeKey?: string;
  onDeleted?(target: TaskSessionDeleteTarget): void;
}

// One confirmation owner across Sidebar, Project and composer entry points.
let pending: { hostId: string | null; sessionId: string } | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getPending = () => pending;
const notify = () => listeners.forEach((listener) => listener());

export function useDeleteTaskSession({
  hostId,
  scopeKey,
  discoveryScopeKey,
  onDeleted,
}: DeleteTaskSessionOptions) {
  const queryClient = useQueryClient();
  const { t } = useTranslation('tasks');
  const shellProjects = useAppShellProjects();
  const discoveryScope = discoveryScopeKey ?? shellProjects?.scopeKey;
  const activePending = useSyncExternalStore(subscribe, getPending, getPending);
  const live = useRef({
    hostId,
    scopeKey,
    generation: 0,
    mounted: true,
    onDeleted,
  });
  if (live.current.hostId !== hostId || live.current.scopeKey !== scopeKey) {
    live.current.generation += 1;
  }
  Object.assign(live.current, { hostId, scopeKey, onDeleted });
  useLayoutEffect(() => {
    const scope = live.current;
    scope.mounted = true;
    return () => {
      scope.mounted = false;
      scope.generation += 1;
    };
  }, []);

  const deleteSession = useCallback(
    async (target: TaskSessionDeleteTarget) => {
      if (
        pending ||
        !live.current.mounted ||
        live.current.hostId !== hostId ||
        live.current.scopeKey !== scopeKey
      )
        return;
      const generation = live.current.generation;
      const current = () =>
        live.current.mounted && live.current.generation === generation;
      const assertCurrent = () => {
        if (!current()) throw new Error(t('sessionDeletion.scopeChanged'));
      };
      const trigger =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      pending = { hostId, sessionId: target.sessionId };
      notify();
      try {
        const result = await DeleteTaskSessionDialog.show({
          resolveTarget: async () => {
            assertCurrent();
            const [task, deletionInfo] = await Promise.all([
              sessionsApi.getTask(target.sessionId, hostId),
              sessionsApi.getDeletionInfo(target.sessionId, hostId),
            ]);
            assertCurrent();
            if (
              (target.taskId && target.taskId !== task?.id) ||
              (task &&
                (task.open_target.kind !== 'agent' ||
                  task.open_target.session_id !== target.sessionId ||
                  task.open_target.workspace_id !== target.workspaceId))
            ) {
              throw new Error(t('sessionDeletion.bindingChanged'));
            }
            return { title: task?.title ?? target.title, task, deletionInfo };
          },
          onDelete: async ({ task }, stopRunning, deleteManagedFiles) => {
            assertCurrent();
            let result;
            if (task) {
              result = await executionDataApi.deleteTask(
                task.id,
                target.sessionId,
                hostId,
                stopRunning,
                deleteManagedFiles
              );
            } else {
              // A newly bound Task must be rejected by Session DELETE. Never
              // escalate an already confirmed standalone scope into Task deletion.
              result = await sessionsApi.delete(
                target.sessionId,
                hostId,
                stopRunning,
                deleteManagedFiles
              );
            }
            // Run the guarded selection update before refetch can select a sibling.
            try {
              if (current()) live.current.onDeleted?.(target);
            } catch (cause) {
              // Deletion is durable; navigation cannot turn it into a retry.
              console.error('Unable to update selection after deletion', cause);
            }
            const hostKey = getHostRequestScopeQueryKey(hostId);
            await Promise.allSettled([
              queryClient.invalidateQueries({
                queryKey: workspaceSessionKeys.byWorkspace(
                  target.workspaceId,
                  hostId
                ),
              }),
              queryClient.invalidateQueries({
                queryKey: ['project-tasks'],
                predicate: ({ queryKey }) =>
                  queryKey[2] === hostKey &&
                  (!task || queryKey[1] === task.project_id),
              }),
              queryClient.invalidateQueries({
                queryKey: ['app-shell', 'discovery'],
                predicate: ({ queryKey, meta }) =>
                  (discoveryScope !== undefined
                    ? queryKey[2] === discoveryScope
                    : meta?.hostId === hostId) &&
                  (queryKey[3] === 'sessions' || queryKey[3] === 'projects'),
              }),
            ]);
            return result;
          },
        });
        if (result === 'canceled') {
          // Pending disables the trigger before Radix captures return focus.
          // Wait for the final pending reset to re-enable the original button.
          requestAnimationFrame(() => {
            if (!pending && current() && trigger?.isConnected) {
              trigger.focus({ preventScroll: true });
            }
          });
        }
      } finally {
        pending = null;
        notify();
      }
    },
    [discoveryScope, hostId, queryClient, scopeKey, t]
  );

  return {
    deleteSession,
    pendingSessionId:
      activePending?.hostId === hostId ? activePending.sessionId : null,
  };
}
