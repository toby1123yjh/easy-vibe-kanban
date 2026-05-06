import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  arenaApi,
  type ArenaMessageRequest,
  type ArenaGroupResponse,
  type CloseArenaResponse,
  type DissolveArenaResponse,
  type RetryArenaRequest,
  type StartArenaImplementationRequest,
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
  close: UseMutationResult<CloseArenaResponse, Error, void>;
  message: UseMutationResult<ArenaGroupResponse, Error, ArenaMessageRequest>;
  startImplementation: UseMutationResult<
    ArenaGroupResponse,
    Error,
    StartArenaImplementationRequest
  >;
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

  const close = useMutation({
    mutationFn: () => arenaApi.close(groupId),
    onSettled,
  });

  const message = useMutation({
    mutationFn: (payload: ArenaMessageRequest) =>
      arenaApi.message(groupId, payload),
    onSuccess: (data) => {
      queryClient.setQueryData(arenaQueryKeys.group(groupId), data);
    },
    onSettled,
  });

  const startImplementation = useMutation({
    mutationFn: (payload: StartArenaImplementationRequest) =>
      arenaApi.startImplementation(groupId, payload),
    onSuccess: (data) => {
      queryClient.setQueryData(arenaQueryKeys.group(groupId), data);
    },
    onSettled,
  });

  return { promote, retry, dissolve, close, message, startImplementation };
}
