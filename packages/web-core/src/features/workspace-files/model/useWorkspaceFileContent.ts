import { useQuery, useQueryClient } from '@tanstack/react-query';
import { workspacesApi } from '@/shared/lib/api';
import { useHostId } from '@/shared/providers/HostIdProvider';
import type { WorkspaceFilePreviewTarget } from './types';
import { workspaceFileKeys } from './workspaceFileKeys';

export function useWorkspaceFileContent(
  target: WorkspaceFilePreviewTarget | null | undefined
) {
  const hostId = useHostId();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: workspaceFileKeys.content(
      target?.workspaceId,
      target?.repoId,
      target?.path,
      hostId
    ),
    queryFn: () =>
      workspacesApi.files.content(target!.workspaceId, {
        repoId: target!.repoId,
        path: target!.path,
      }),
    enabled: !!target,
  });

  const refresh = () => {
    if (!target) return Promise.resolve();
    return queryClient.invalidateQueries({
      queryKey: workspaceFileKeys.content(
        target.workspaceId,
        target.repoId,
        target.path,
        hostId
      ),
    });
  };

  return {
    ...query,
    refresh,
  } as const;
}
