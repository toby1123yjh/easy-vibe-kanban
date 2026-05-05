import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { arenaApi, type ArenaGroupResponse } from '@/shared/lib/arenaApi';

// Query-key conventions live next to the hook so other call sites can
// invalidate by group / by issue without redefining the shape.
export const arenaQueryKeys = {
  all: ['arena'] as const,
  group: (groupId: string) => ['arena', 'group', groupId] as const,
  activeForIssue: (issueId: string) =>
    ['arena', 'issue', issueId, 'active'] as const,
};

interface UseArenaGroupOptions {
  /**
   * Polling interval in ms while at least one workspace in the group
   * is still in `active` status. Set to `false` to disable polling
   * (caller is responsible for invalidation).
   *
   * Defaults to 4s while an attempt is running. Once every workspace
   * is `promoted` or `archived`, polling stops automatically.
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
  const { refetchIntervalMs = DEFAULT_REFETCH_INTERVAL_MS, enabled = true } =
    options;

  return useQuery({
    queryKey: groupId ? arenaQueryKeys.group(groupId) : ['arena', 'noop'],
    queryFn: () => arenaApi.get(groupId as string),
    enabled: !!groupId && enabled,
    refetchInterval: (query) => {
      if (refetchIntervalMs === false) return false;
      const data = query.state.data as ArenaGroupResponse | undefined;
      if (!data) return refetchIntervalMs;
      const stillRunning = data.workspaces.some(
        (ws) => ws.arena_status === 'active'
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
export function useActiveArenaForIssue(
  issueId: string | null | undefined,
  options: UseArenaGroupOptions = {}
): UseQueryResult<ArenaGroupResponse | null> {
  const { refetchIntervalMs = DEFAULT_REFETCH_INTERVAL_MS, enabled = true } =
    options;

  return useQuery({
    queryKey: issueId
      ? arenaQueryKeys.activeForIssue(issueId)
      : ['arena', 'noop'],
    queryFn: () => arenaApi.getActiveForIssue(issueId as string),
    enabled: !!issueId && enabled,
    refetchInterval: (query) => {
      if (refetchIntervalMs === false) return false;
      const data = query.state.data as ArenaGroupResponse | null | undefined;
      if (!data) return refetchIntervalMs;
      const stillRunning = data.workspaces.some(
        (ws) => ws.arena_status === 'active'
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
  const queryClient = useQueryClient();

  const invalidateGroup = useCallback(
    (groupId: string) => {
      void queryClient.invalidateQueries({
        queryKey: arenaQueryKeys.group(groupId),
      });
    },
    [queryClient]
  );

  const invalidateIssue = useCallback(
    (issueId: string) => {
      void queryClient.invalidateQueries({
        queryKey: arenaQueryKeys.activeForIssue(issueId),
      });
    },
    [queryClient]
  );

  const invalidateAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: arenaQueryKeys.all });
  }, [queryClient]);

  return { invalidateGroup, invalidateIssue, invalidateAll };
}
