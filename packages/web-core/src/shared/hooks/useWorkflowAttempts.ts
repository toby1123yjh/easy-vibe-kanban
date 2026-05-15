import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { workflowApi } from '@/shared/lib/workflowApi';
import type {
  CreateWorkflowAttemptRequest,
  RunWorkflowAttemptRequest,
  WorkflowAttemptListResponse,
  WorkflowAttemptResponse,
} from 'shared/types';
import { workflowRunQueryKeys } from './useWorkflowRun';
import { workflowTemplateQueryKeys } from './useWorkflowTemplates';

export const workflowAttemptQueryKeys = {
  all: ['workflow-attempts'] as const,
  issue: (projectId: string, issueId: string) =>
    ['workflow-attempts', 'project', projectId, 'issue', issueId] as const,
  detail: (attemptId: string) =>
    ['workflow-attempts', 'detail', attemptId] as const,
  workflow: (workflowId: string) =>
    ['workflow-attempts', 'workflow', workflowId] as const,
};

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
      payload: CreateWorkflowAttemptRequest;
    }) => workflowApi.createAttempt(projectId, issueId, payload),
    onSuccess: (attempt, variables) => {
      void queryClient.invalidateQueries({
        queryKey: workflowAttemptQueryKeys.issue(
          variables.projectId,
          variables.issueId
        ),
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
      payload: RunWorkflowAttemptRequest;
    }) => workflowApi.runAttempt(attemptId, payload),
    onSuccess: (run) => {
      queryClient.setQueryData(workflowRunQueryKeys.detail(run.id), run);
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

  return {
    createAttempt: createAttemptMutation.mutateAsync,
    isCreatingAttempt: createAttemptMutation.isPending,
    runAttempt: runAttemptMutation.mutateAsync,
    isRunningAttempt: runAttemptMutation.isPending,
  };
}
