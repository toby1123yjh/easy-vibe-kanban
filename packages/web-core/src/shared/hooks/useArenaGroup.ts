import { getCurrentHostId, useHostId } from '@/shared/providers/HostIdProvider';
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import {
  createArenaApi,
  isActiveArenaAgentRunStatus,
  type ArenaGroupResponse,
} from '@/shared/lib/arenaApi';

// Query-key conventions live next to the hook so other call sites can
// invalidate by group / by issue without redefining the shape.
export const arenaQueryKeys = {
  all: ['arena'] as const,
  host: (hostId = getCurrentHostId()) => ['arena', hostId] as const,
  group: (groupId: string, hostId = getCurrentHostId()) =>
    ['arena', hostId, 'group', groupId] as const,
  activeForTask: (taskId: string, hostId = getCurrentHostId()) =>
    ['arena', hostId, 'task', taskId, 'active'] as const,
};

interface UseArenaGroupOptions {
  /**
   * Polling interval in ms while at least one workspace has an active
   * AgentRun. Set to `false` to disable polling
   * (caller is responsible for invalidation).
   *
   * Defaults to 4s while an attempt is active. Polling stops once every
   * workspace's latest AgentRun is terminal or absent.
   */
  refetchIntervalMs?: number | false;
  enabled?: boolean;
}

const DEFAULT_REFETCH_INTERVAL_MS = 4000;

/**
 * Fetch a single arena group by id, including its workspace summaries.
 * Polls while at least one attempt is still in flight.
 */
export function useArenaGroup(
  groupId: string | null | undefined,
  options: UseArenaGroupOptions = {}
): UseQueryResult<ArenaGroupResponse> {
  const hostId = useHostId();
  const arenaApi = createArenaApi(hostId);
  const { refetchIntervalMs = DEFAULT_REFETCH_INTERVAL_MS, enabled = true } =
    options;

  return useQuery({
    queryKey: groupId
      ? arenaQueryKeys.group(groupId, hostId)
      : ['arena', 'noop'],
    queryFn: () => arenaApi.get(groupId as string),
    enabled: !!groupId && enabled,
    refetchInterval: (query) => {
      if (refetchIntervalMs === false) return false;
      const data = query.state.data as ArenaGroupResponse | undefined;
      if (!data) return false;
      const stillRunning = data.workspaces.some((ws) =>
        isActiveArenaAgentRunStatus(ws.latest_agent_run_status)
      );
      return stillRunning ? refetchIntervalMs : false;
    },
    // Once we've seen a final-state group, the data is durable enough
    // that we don't need to refetch on focus until the user mutates.
    refetchOnWindowFocus: false,
  });
}

/**
 * Look up the (at most one) un-promoted arena group for an issue.
 * Used by the kanban-card → arena-tab redirect: when present, the
 * issue detail page should default to the arena view.
 */
export function useActiveArenaForTask(
  taskId: string | null | undefined,
  options: UseArenaGroupOptions = {}
): UseQueryResult<ArenaGroupResponse | null> {
  const hostId = useHostId();
  const arenaApi = createArenaApi(hostId);
  const { refetchIntervalMs = DEFAULT_REFETCH_INTERVAL_MS, enabled = true } =
    options;

  return useQuery({
    queryKey: taskId
      ? arenaQueryKeys.activeForTask(taskId, hostId)
      : ['arena', 'noop'],
    queryFn: () => arenaApi.getActiveForTask(taskId as string),
    enabled: !!taskId && enabled,
    refetchInterval: (query) => {
      if (refetchIntervalMs === false) return false;
      const data = query.state.data as ArenaGroupResponse | null | undefined;
      if (!data) return false;
      if (data.lifecycle_status !== 'open') return false;
      const stillRunning = data.workspaces.some((ws) =>
        isActiveArenaAgentRunStatus(ws.latest_agent_run_status)
      );
      return stillRunning ? refetchIntervalMs : false;
    },
    refetchOnWindowFocus: false,
  });
}

/**
 * Imperative invalidation helpers — call from mutation handlers
 * (Step 3) so the user sees promote/retry/dissolve effects without
 * waiting for the next poll tick.
 */
export function useArenaInvalidators() {
  const hostId = useHostId();
  const queryClient = useQueryClient();

  const invalidateGroup = useCallback(
    (groupId: string) => {
      void queryClient.invalidateQueries({
        queryKey: arenaQueryKeys.group(groupId, hostId),
      });
    },
    [queryClient, hostId]
  );

  const invalidateTask = useCallback(
    (taskId: string) => {
      void queryClient.invalidateQueries({
        queryKey: arenaQueryKeys.activeForTask(taskId, hostId),
      });
    },
    [queryClient, hostId]
  );

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: arenaQueryKeys.host(hostId),
    });
  }, [queryClient, hostId]);

  return { invalidateGroup, invalidateTask, invalidateAll };
}
