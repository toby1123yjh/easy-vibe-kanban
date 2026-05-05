import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  arenaApi,
  type ArenaGroupResponse,
  type DissolveArenaResponse,
  type RetryArenaRequest,
} from '@/shared/lib/arenaApi';
import { arenaQueryKeys } from '@/shared/hooks/useArenaGroup';

interface UseArenaActionsResult {
  promote: UseMutationResult<
    ArenaGroupResponse,
    Error,
    { workspaceId: string }
  >;
  retry: UseMutationResult<
    ArenaGroupResponse,
    Error,
    { workspaceId: string; payload: RetryArenaRequest }
  >;
  dissolve: UseMutationResult<DissolveArenaResponse, Error, void>;
}

/**
 * Mutation hook for the three arena state transitions:
 *   - promote: pick one workspace as the winner; siblings get archived
 *   - retry:   archive a single workspace and spawn a fresh sibling
 *   - dissolve: archive every workspace and delete the group
 *
 * Each mutation invalidates the group query (so the polling-based
 * `useArenaGroup` immediately picks up the new state) and the
 * issue-level "active arena" query (so the kanban side picks up
 * promotion / dissolution).
 */
export function useArenaActions(
  groupId: string,
  issueId: string | null
): UseArenaActionsResult {
  const queryClient = useQueryClient();

  const onSettled = () => {
    void queryClient.invalidateQueries({
      queryKey: arenaQueryKeys.group(groupId),
    });
    if (issueId) {
      void queryClient.invalidateQueries({
        queryKey: arenaQueryKeys.activeForIssue(issueId),
      });
    }
  };

  const promote = useMutation({
    mutationFn: ({ workspaceId }: { workspaceId: string }) =>
      arenaApi.promote(groupId, { workspace_id: workspaceId }),
    onSuccess: (data) => {
      queryClient.setQueryData(arenaQueryKeys.group(groupId), data);
    },
    onSettled,
  });

  const retry = useMutation({
    mutationFn: ({
      workspaceId,
      payload,
    }: {
      workspaceId: string;
      payload: RetryArenaRequest;
    }) => arenaApi.retry(groupId, workspaceId, payload),
    onSuccess: (data) => {
      queryClient.setQueryData(arenaQueryKeys.group(groupId), data);
    },
    onSettled,
  });

  const dissolve = useMutation({
    mutationFn: () => arenaApi.dissolve(groupId),
    onSettled,
  });

  return { promote, retry, dissolve };
}
