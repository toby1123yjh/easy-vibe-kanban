import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { workflowApi } from '@/shared/lib/workflowApi';
import type {
  WorkflowTemplateResponse,
  WorkflowTemplateListResponse,
  CreateWorkflowRequest,
  UpdateWorkflowRequest,
} from 'shared/types';

export const workflowTemplateQueryKeys = {
  all: ['workflow-templates'] as const,
  list: (projectId: string) =>
    ['workflow-templates', 'project', projectId] as const,
  detail: (workflowId: string) =>
    ['workflow-templates', 'detail', workflowId] as const,
};

export interface UseWorkflowTemplatesOptions {
  enabled?: boolean;
}

export function useWorkflowTemplates(
  projectId: string | null | undefined,
  options: UseWorkflowTemplatesOptions = {}
): UseQueryResult<WorkflowTemplateListResponse> {
  const { enabled = true } = options;

  return useQuery({
    queryKey: projectId
      ? workflowTemplateQueryKeys.list(projectId)
      : ['workflow-templates', 'noop'],
    queryFn: () => workflowApi.list(projectId as string),
    enabled: !!projectId && enabled,
  });
}

export function useWorkflowTemplate(
  workflowId: string | null | undefined,
  options: UseWorkflowTemplatesOptions = {}
): UseQueryResult<WorkflowTemplateResponse> {
  const { enabled = true } = options;

  return useQuery({
    queryKey: workflowId
      ? workflowTemplateQueryKeys.detail(workflowId)
      : ['workflow-templates', 'detail', 'noop'],
    queryFn: () => workflowApi.get(workflowId as string),
    enabled: !!workflowId && enabled,
  });
}

export function useWorkflowTemplateMutations() {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: ({
      projectId,
      payload,
    }: {
      projectId: string;
      payload: CreateWorkflowRequest;
    }) => workflowApi.create(projectId, payload),
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: workflowTemplateQueryKeys.list(variables.projectId),
      });
      queryClient.setQueryData(workflowTemplateQueryKeys.detail(data.id), data);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      workflowId,
      payload,
    }: {
      workflowId: string;
      payload: UpdateWorkflowRequest;
    }) => workflowApi.update(workflowId, payload),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: workflowTemplateQueryKeys.all,
      });
      queryClient.setQueryData(workflowTemplateQueryKeys.detail(data.id), data);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (workflowId: string) => workflowApi.delete(workflowId),
    onSuccess: (_, workflowId) => {
      void queryClient.invalidateQueries({
        queryKey: workflowTemplateQueryKeys.all,
      });
      queryClient.removeQueries({
        queryKey: workflowTemplateQueryKeys.detail(workflowId),
      });
    },
  });

  return {
    createTemplate: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    updateTemplate: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    deleteTemplate: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
  };
}
