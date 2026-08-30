import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import {
  arenaApi,
  isCancellableArenaAgentRunStatus,
  type ArenaMessageRequest,
  type ArenaGroupResponse,
  type CloseArenaResponse,
  type DissolveArenaResponse,
  type RetryArenaRequest,
  type StartArenaImplementationRequest,
} from '@/shared/lib/arenaApi';
import { agentRunsApi } from '@/shared/lib/agentRunApi';
import { arenaQueryKeys } from '@/shared/hooks/useArenaGroup';

interface UseArenaActionsResult {
  promote: UseMutationResult<
    ArenaGroupResponse,
    Error,
    { candidateId: string }
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
  stopAll: UseMutationResult<
    ArenaStopAllResult,
    Error,
    { sessionIds: string[] }
  >;
}

export interface ArenaStopAllResult {
  requestedAgentRunIds: string[];
  cancelledAgentRunIds: string[];
  failures: string[];
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
    mutationFn: ({ candidateId }: { candidateId: string }) =>
      arenaApi.promote(groupId, { candidate_id: candidateId }),
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

  const stopAll = useMutation({
    mutationFn: async ({ sessionIds }: { sessionIds: string[] }) => {
      const uniqueSessionIds = [...new Set(sessionIds)];
      const discoveries = await Promise.allSettled(
        uniqueSessionIds.map(async (sessionId) => ({
          sessionId,
          runs: await agentRunsApi.listForSession(sessionId),
        }))
      );
      const failures: string[] = [];
      const requestedAgentRunIds = new Set<string>();

      for (const discovery of discoveries) {
        if (discovery.status === 'rejected') {
          failures.push(
            discovery.reason instanceof Error
              ? discovery.reason.message
              : String(discovery.reason)
          );
          continue;
        }
        for (const run of discovery.value.runs) {
          if (isCancellableArenaAgentRunStatus(run.state.status)) {
            requestedAgentRunIds.add(run.agent_run_id);
          }
        }
      }

      const requested = [...requestedAgentRunIds];
      const cancellations = await Promise.allSettled(
        requested.map(async (agentRunId) => {
          await agentRunsApi.cancel(agentRunId, 'Arena stopped by user.');
          return agentRunId;
        })
      );
      const cancelledAgentRunIds: string[] = [];
      for (const cancellation of cancellations) {
        if (cancellation.status === 'fulfilled') {
          cancelledAgentRunIds.push(cancellation.value);
        } else {
          failures.push(
            cancellation.reason instanceof Error
              ? cancellation.reason.message
              : String(cancellation.reason)
          );
        }
      }

      return {
        requestedAgentRunIds: requested,
        cancelledAgentRunIds,
        failures,
      } satisfies ArenaStopAllResult;
    },
    onSettled,
  });

  return {
    promote,
    retry,
    dissolve,
    close,
    message,
    startImplementation,
    stopAll,
  };
}
