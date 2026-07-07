import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { scheduledTaskApi } from '@/shared/lib/scheduledTaskApi';
import type {
  ListScheduledTasksQuery,
  ScheduledTaskListResponse,
  ScheduledTaskResponse,
  ScheduledTaskRunNowResponse,
  UpdateScheduledTaskRequest,
  UpsertScheduledTaskRequest,
} from 'shared/types';
import { workflowAttemptQueryKeys } from './useWorkflowAttempts';
import { workflowRunQueryKeys } from './useWorkflowRun';

export const scheduledTaskQueryKeys = {
  all: ['scheduled-tasks'] as const,
  project: (projectId: string) =>
    ['scheduled-tasks', 'project', projectId] as const,
  projectFiltered: (
    projectId: string,
    filters: ListScheduledTasksQuery | undefined
  ) =>
    [
      'scheduled-tasks',
      'project',
      projectId,
      filters?.target_type ?? 'all',
      filters?.target_id ?? 'all',
    ] as const,
  workflow: (projectId: string, workflowId: string) =>
    ['scheduled-tasks', 'project', projectId, 'workflow', workflowId] as const,
  detail: (taskId: string) => ['scheduled-tasks', 'detail', taskId] as const,
};

interface UseScheduledTasksOptions {
  enabled?: boolean;
}

function setScheduledTaskCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  task: ScheduledTaskResponse
) {
  queryClient.setQueryData(scheduledTaskQueryKeys.detail(task.id), task);
  if (task.target_type === 'workflow') {
    queryClient.setQueryData(
      scheduledTaskQueryKeys.workflow(task.project_id, task.target_id),
      task
    );
  }
}

export function useScheduledTasks(
  projectId: string | null | undefined,
  filters?: ListScheduledTasksQuery,
  options: UseScheduledTasksOptions = {}
): UseQueryResult<ScheduledTaskListResponse> {
  const { enabled = true } = options;

  return useQuery({
    queryKey: projectId
      ? scheduledTaskQueryKeys.projectFiltered(projectId, filters)
      : ['scheduled-tasks', 'noop'],
    queryFn: () => scheduledTaskApi.list(projectId as string, filters),
    enabled: !!projectId && enabled,
  });
}

export function useWorkflowScheduledTask(
  projectId: string | null | undefined,
  workflowId: string | null | undefined,
  options: UseScheduledTasksOptions = {}
): UseQueryResult<ScheduledTaskResponse | null> {
  const { enabled = true } = options;

  return useQuery({
    queryKey:
      projectId && workflowId
        ? scheduledTaskQueryKeys.workflow(projectId, workflowId)
        : ['scheduled-tasks', 'workflow', 'noop'],
    queryFn: async () => {
      const response = await scheduledTaskApi.list(projectId as string, {
        target_type: 'workflow',
        target_id: workflowId as string,
      });
      return response.tasks[0] ?? null;
    },
    enabled: !!projectId && !!workflowId && enabled,
  });
}

export function useScheduledTaskMutations() {
  const queryClient = useQueryClient();

  const upsertMutation = useMutation({
    mutationFn: ({
      projectId,
      payload,
    }: {
      projectId: string;
      payload: UpsertScheduledTaskRequest;
    }) => scheduledTaskApi.upsert(projectId, payload),
    onSuccess: (task) => {
      setScheduledTaskCaches(queryClient, task);
      void queryClient.invalidateQueries({
        queryKey: scheduledTaskQueryKeys.project(task.project_id),
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      taskId,
      payload,
    }: {
      taskId: string;
      payload: UpdateScheduledTaskRequest;
    }) => scheduledTaskApi.update(taskId, payload),
    onSuccess: (task) => {
      setScheduledTaskCaches(queryClient, task);
      void queryClient.invalidateQueries({
        queryKey: scheduledTaskQueryKeys.project(task.project_id),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (task: ScheduledTaskResponse) =>
      scheduledTaskApi.delete(task.id),
    onSuccess: (_, task) => {
      queryClient.removeQueries({
        queryKey: scheduledTaskQueryKeys.detail(task.id),
      });
      queryClient.setQueryData(
        scheduledTaskQueryKeys.workflow(task.project_id, task.target_id),
        null
      );
      void queryClient.invalidateQueries({
        queryKey: scheduledTaskQueryKeys.project(task.project_id),
      });
    },
  });

  const runNowMutation = useMutation({
    mutationFn: (taskId: string) => scheduledTaskApi.runNow(taskId),
    onSuccess: (result: ScheduledTaskRunNowResponse) => {
      setScheduledTaskCaches(queryClient, result.task);
      if (result.run) {
        queryClient.setQueryData(
          workflowRunQueryKeys.detail(result.run.id),
          result.run
        );
      }
      void queryClient.invalidateQueries({
        queryKey: scheduledTaskQueryKeys.project(result.task.project_id),
      });
      void queryClient.invalidateQueries({
        queryKey: workflowAttemptQueryKeys.project(result.task.project_id),
      });
      void queryClient.invalidateQueries({
        queryKey: workflowAttemptQueryKeys.all,
      });
    },
  });

  return {
    upsertTask: upsertMutation.mutateAsync,
    isUpsertingTask: upsertMutation.isPending,
    updateTask: updateMutation.mutateAsync,
    isUpdatingTask: updateMutation.isPending,
    deleteTask: deleteMutation.mutateAsync,
    isDeletingTask: deleteMutation.isPending,
    runNow: runNowMutation.mutateAsync,
    isRunningNow: runNowMutation.isPending,
  };
}
