import { getCurrentHostId, useHostId } from '@/shared/providers/HostIdProvider';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { createScheduledTaskApi } from '@/shared/lib/scheduledTaskApi';
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
  host: (hostId = getCurrentHostId()) => ['scheduled-tasks', hostId] as const,
  project: (projectId: string, hostId = getCurrentHostId()) =>
    ['scheduled-tasks', hostId, 'project', projectId] as const,
  projectFiltered: (
    projectId: string,
    filters: ListScheduledTasksQuery | undefined,
    hostId = getCurrentHostId()
  ) =>
    [
      'scheduled-tasks',
      hostId,
      'project',
      projectId,
      filters?.target_type ?? 'all',
      filters?.target_id ?? 'all',
    ] as const,
  workflow: (
    projectId: string,
    workflowId: string,
    hostId = getCurrentHostId()
  ) =>
    [
      'scheduled-tasks',
      hostId,
      'project',
      projectId,
      'workflow',
      workflowId,
    ] as const,
  detail: (taskId: string, hostId = getCurrentHostId()) =>
    ['scheduled-tasks', hostId, 'detail', taskId] as const,
};

interface UseScheduledTasksOptions {
  enabled?: boolean;
}

function setScheduledTaskCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  task: ScheduledTaskResponse,
  hostId: string | null
) {
  queryClient.setQueryData(
    scheduledTaskQueryKeys.detail(task.id, hostId),
    task
  );
  if (task.target_type === 'workflow') {
    queryClient.setQueryData(
      scheduledTaskQueryKeys.workflow(task.project_id, task.target_id, hostId),
      task
    );
  }
}

export function useScheduledTasks(
  projectId: string | null | undefined,
  filters?: ListScheduledTasksQuery,
  options: UseScheduledTasksOptions = {}
): UseQueryResult<ScheduledTaskListResponse> {
  const hostId = useHostId();
  const scheduledTaskApi = createScheduledTaskApi(hostId);
  const { enabled = true } = options;

  return useQuery({
    queryKey: projectId
      ? scheduledTaskQueryKeys.projectFiltered(projectId, filters, hostId)
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
  const hostId = useHostId();
  const scheduledTaskApi = createScheduledTaskApi(hostId);
  const { enabled = true } = options;

  return useQuery({
    queryKey:
      projectId && workflowId
        ? scheduledTaskQueryKeys.workflow(projectId, workflowId, hostId)
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
  const hostId = useHostId();
  const scheduledTaskApi = createScheduledTaskApi(hostId);
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
      setScheduledTaskCaches(queryClient, task, hostId);
      void queryClient.invalidateQueries({
        queryKey: scheduledTaskQueryKeys.project(task.project_id, hostId),
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
      setScheduledTaskCaches(queryClient, task, hostId);
      void queryClient.invalidateQueries({
        queryKey: scheduledTaskQueryKeys.project(task.project_id, hostId),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (task: ScheduledTaskResponse) =>
      scheduledTaskApi.delete(task.id),
    onSuccess: (_, task) => {
      queryClient.removeQueries({
        queryKey: scheduledTaskQueryKeys.detail(task.id, hostId),
      });
      queryClient.setQueryData(
        scheduledTaskQueryKeys.workflow(
          task.project_id,
          task.target_id,
          hostId
        ),
        null
      );
      void queryClient.invalidateQueries({
        queryKey: scheduledTaskQueryKeys.project(task.project_id, hostId),
      });
    },
  });

  const runNowMutation = useMutation({
    mutationFn: (taskId: string) => scheduledTaskApi.runNow(taskId),
    onSuccess: (result: ScheduledTaskRunNowResponse) => {
      setScheduledTaskCaches(queryClient, result.task, hostId);
      if (result.run) {
        queryClient.setQueryData(
          workflowRunQueryKeys.detail(result.run.id, hostId),
          result.run
        );
      }
      void queryClient.invalidateQueries({
        queryKey: scheduledTaskQueryKeys.project(
          result.task.project_id,
          hostId
        ),
      });
      void queryClient.invalidateQueries({
        queryKey: workflowAttemptQueryKeys.project(
          result.task.project_id,
          hostId
        ),
      });
      void queryClient.invalidateQueries({
        queryKey: workflowAttemptQueryKeys.host(hostId),
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
