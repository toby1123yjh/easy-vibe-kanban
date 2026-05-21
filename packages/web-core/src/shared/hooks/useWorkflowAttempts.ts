import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  workflowApi,
  type CreateWorkflowAttemptPayload,
  type RunWorkflowAttemptPayload,
} from '@/shared/lib/workflowApi';
import type {
  WorkflowAttemptListResponse,
  WorkflowAttemptResponse,
  WorkflowAttemptStatus,
  WorkflowRunStatus,
} from 'shared/types';
import { workflowRunQueryKeys } from './useWorkflowRun';
import { workflowTemplateQueryKeys } from './useWorkflowTemplates';

export const workflowAttemptQueryKeys = {
  all: ['workflow-attempts'] as const,
  project: (projectId: string) =>
    ['workflow-attempts', 'project', projectId] as const,
  issue: (projectId: string, issueId: string) =>
    ['workflow-attempts', 'project', projectId, 'issue', issueId] as const,
  detail: (attemptId: string) =>
    ['workflow-attempts', 'detail', attemptId] as const,
  workflow: (workflowId: string) =>
    ['workflow-attempts', 'workflow', workflowId] as const,
};

function workflowAttemptStatusFromRunStatus(
  status: WorkflowRunStatus
): WorkflowAttemptStatus {
  return status === 'pending' ? 'ready' : status;
}

function updateCachedWorkflowAttempt(
  queryClient: QueryClient,
  attemptId: string,
  updater: (attempt: WorkflowAttemptResponse) => WorkflowAttemptResponse | null
) {
  queryClient
    .getQueriesData<WorkflowAttemptListResponse>({
      queryKey: workflowAttemptQueryKeys.all,
    })
    .forEach(([queryKey, data]) => {
      if (!data?.attempts) return;
      queryClient.setQueryData<WorkflowAttemptListResponse>(queryKey, {
        ...data,
        attempts: data.attempts
          .map((attempt) =>
            attempt.id === attemptId ? updater(attempt) : attempt
          )
          .filter((attempt): attempt is WorkflowAttemptResponse =>
            Boolean(attempt)
          ),
      });
    });

  queryClient
    .getQueriesData<WorkflowAttemptResponse | null>({
      queryKey: workflowAttemptQueryKeys.all,
    })
    .forEach(([queryKey, data]) => {
      if (data?.id === attemptId) {
        queryClient.setQueryData(queryKey, updater(data));
      }
    });
}

export function useWorkflowAttempts(
  projectId: string | null | undefined,
  issueId: string | null | undefined,
  options: { enabled?: boolean } = {}
): UseQueryResult<WorkflowAttemptListResponse> {
  const { enabled = true } = options;

  return useQuery({
    queryKey:
      projectId && issueId
        ? workflowAttemptQueryKeys.issue(projectId, issueId)
        : ['workflow-attempts', 'noop'],
    queryFn: () =>
      workflowApi.listAttempts(projectId as string, issueId as string),
    enabled: !!projectId && !!issueId && enabled,
  });
}

export function useProjectWorkflowAttempts(
  projectId: string | null | undefined,
  options: { enabled?: boolean } = {}
): UseQueryResult<WorkflowAttemptListResponse> {
  const { enabled = true } = options;

  return useQuery({
    queryKey: projectId
      ? workflowAttemptQueryKeys.project(projectId)
      : ['workflow-attempts', 'project', 'noop'],
    queryFn: () => workflowApi.listProjectAttempts(projectId as string),
    enabled: !!projectId && enabled,
  });
}

export function useWorkflowAttemptForWorkflow(
  workflowId: string | null | undefined,
  options: { enabled?: boolean } = {}
): UseQueryResult<WorkflowAttemptResponse | null> {
  const { enabled = true } = options;

  return useQuery({
    queryKey: workflowId
      ? workflowAttemptQueryKeys.workflow(workflowId)
      : ['workflow-attempts', 'workflow', 'noop'],
    queryFn: () => workflowApi.getAttemptForWorkflow(workflowId as string),
    enabled: !!workflowId && enabled,
  });
}

export function useWorkflowAttemptMutations() {
  const queryClient = useQueryClient();

  const createAttemptMutation = useMutation({
    mutationFn: ({
      projectId,
      issueId,
      payload,
    }: {
      projectId: string;
      issueId: string;
      payload: CreateWorkflowAttemptPayload;
    }) => workflowApi.createAttempt(projectId, issueId, payload),
    onSuccess: (attempt, variables) => {
      void queryClient.invalidateQueries({
        queryKey: workflowAttemptQueryKeys.issue(
          variables.projectId,
          variables.issueId
        ),
      });
      void queryClient.invalidateQueries({
        queryKey: workflowAttemptQueryKeys.project(variables.projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: workflowTemplateQueryKeys.list(variables.projectId),
      });
      queryClient.setQueryData(
        workflowAttemptQueryKeys.detail(attempt.id),
        attempt
      );
      queryClient.setQueryData(
        workflowAttemptQueryKeys.workflow(attempt.workflow_id),
        attempt
      );
    },
  });

  const runAttemptMutation = useMutation({
    mutationFn: ({
      attemptId,
      payload,
    }: {
      attemptId: string;
      payload: RunWorkflowAttemptPayload;
    }) => workflowApi.runAttempt(attemptId, payload),
    onSuccess: (run) => {
      queryClient.setQueryData(workflowRunQueryKeys.detail(run.id), run);
      if (run.attempt_id) {
        updateCachedWorkflowAttempt(queryClient, run.attempt_id, (attempt) => ({
          ...attempt,
          latest_run_id: run.id,
          workspace_id: run.workspace_id ?? attempt.workspace_id,
          status: workflowAttemptStatusFromRunStatus(run.status),
          updated_at: run.updated_at,
        }));
      }
      void queryClient.invalidateQueries({
        queryKey: workflowAttemptQueryKeys.all,
      });
      if (run.workflow_id) {
        void queryClient.invalidateQueries({
          queryKey: workflowAttemptQueryKeys.workflow(run.workflow_id),
        });
      }
    },
  });

  const deleteAttemptMutation = useMutation({
    mutationFn: (attemptId: string) => workflowApi.deleteAttempt(attemptId),
    onMutate: async (attemptId) => {
      await queryClient.cancelQueries({
        queryKey: workflowAttemptQueryKeys.all,
      });

      const previousLists =
        queryClient.getQueriesData<WorkflowAttemptListResponse>({
          queryKey: workflowAttemptQueryKeys.all,
        });
      const previousDetails =
        queryClient.getQueriesData<WorkflowAttemptResponse | null>({
          queryKey: workflowAttemptQueryKeys.all,
        });

      previousLists.forEach(([queryKey, data]) => {
        if (!data?.attempts) return;
        queryClient.setQueryData<WorkflowAttemptListResponse>(queryKey, {
          ...data,
          attempts: data.attempts.filter((attempt) => attempt.id !== attemptId),
        });
      });

      previousDetails.forEach(([queryKey, data]) => {
        if (data?.id === attemptId) {
          queryClient.setQueryData(queryKey, null);
        }
      });

      return { previousLists, previousDetails };
    },
    onError: (_error, _attemptId, context) => {
      context?.previousLists.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      context?.previousDetails.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: workflowAttemptQueryKeys.all,
      });
      void queryClient.invalidateQueries({
        queryKey: workflowTemplateQueryKeys.all,
      });
    },
  });

  return {
    createAttempt: createAttemptMutation.mutateAsync,
    isCreatingAttempt: createAttemptMutation.isPending,
    runAttempt: runAttemptMutation.mutateAsync,
    isRunningAttempt: runAttemptMutation.isPending,
    deleteAttempt: deleteAttemptMutation.mutateAsync,
    isDeletingAttempt: deleteAttemptMutation.isPending,
  };
}
