import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { DeleteRemoteProjectDialog } from '@/shared/dialogs/org/DeleteRemoteProjectDialog';
import { deleteProjectById } from '@/shared/lib/projectSettings';
import { useAppShellProjects } from './useAppShellProjects';

interface ProjectDeleteTarget {
  id: string;
  name: string;
}

// Directory, board and settings share one confirmation/mutation owner.
let pendingProjectId: string | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getPending = () => pendingProjectId;
const notify = () => listeners.forEach((listener) => listener());

export function useDeleteProject({
  scopeKey,
  enabled = true,
  onDeleted,
}: {
  scopeKey: string;
  enabled?: boolean;
  onDeleted?(project: ProjectDeleteTarget): void;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const projectsState = useAppShellProjects();
  const pending = useSyncExternalStore(subscribe, getPending, getPending);
  const owner = `${projectsState?.scopeKey ?? 'settings'}:${scopeKey}`;
  const live = useRef({ owner, enabled, mounted: true, epoch: 0, onDeleted });
  if (live.current.owner !== owner) live.current.epoch += 1;
  Object.assign(live.current, { owner, enabled, onDeleted });
  useLayoutEffect(() => {
    const current = live.current;
    current.mounted = true;
    return () => {
      current.mounted = false;
    };
  }, []);

  const deleteProject = async (project: ProjectDeleteTarget) => {
    if (pendingProjectId || !live.current.mounted || !live.current.enabled)
      return;
    const epoch = live.current.epoch;
    const location = router.state.location;
    const scope = projectsState?.scopeKey;
    const isCurrent = () =>
      live.current.epoch === epoch &&
      live.current.owner === owner &&
      live.current.enabled &&
      router.state.location === location;
    const canDelete = () => live.current.mounted && isCurrent();
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    pendingProjectId = project.id;
    notify();
    try {
      const result = await DeleteRemoteProjectDialog.show({
        projectName: project.name,
        onDelete: async () => {
          if (!canDelete())
            throw new Error('Project scope changed. Reopen the project menu.');
          await deleteProjectById(project.id, canDelete);
          // Shape deletion can unmount the board before persistence resolves.
          // The unchanged route/scope still owns navigation after durable success.
          // A cache refresh or navigation error must never retry a committed DELETE.
          try {
            if (isCurrent()) live.current.onDeleted?.(project);
          } catch (error) {
            console.error('Unable to navigate after project deletion', error);
          }
          await Promise.allSettled([
            queryClient.invalidateQueries({
              queryKey: ['app-shell', 'discovery'],
              predicate: ({ queryKey }) =>
                scope !== undefined && queryKey[2] === scope,
            }),
            queryClient.invalidateQueries({
              queryKey: ['project-settings', project.id],
            }),
            projectsState?.retry(),
          ]);
        },
      });
      if (result === 'canceled') {
        requestAnimationFrame(() => {
          if (!pendingProjectId && canDelete() && trigger?.isConnected)
            trigger.focus({ preventScroll: true });
        });
      }
    } finally {
      pendingProjectId = null;
      notify();
    }
  };

  return { deleteProject, pendingProjectId: pending };
}
