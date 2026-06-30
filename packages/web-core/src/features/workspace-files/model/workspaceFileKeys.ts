import { getHostRequestScopeQueryKey } from '@/shared/lib/hostRequestScope';

export const workspaceFileKeys = {
  all: ['workspaceFiles'] as const,
  tree: (workspaceId: string | undefined, hostId?: string | null) =>
    [
      ...workspaceFileKeys.all,
      'tree',
      getHostRequestScopeQueryKey(hostId),
      workspaceId,
    ] as const,
  directory: (
    workspaceId: string | undefined,
    repoId: string | undefined,
    path: string | undefined,
    hostId?: string | null
  ) =>
    [
      ...workspaceFileKeys.all,
      'directory',
      getHostRequestScopeQueryKey(hostId),
      workspaceId,
      repoId,
      path ?? '',
    ] as const,
  content: (
    workspaceId: string | undefined,
    repoId: string | undefined,
    path: string | undefined,
    hostId?: string | null
  ) =>
    [
      ...workspaceFileKeys.all,
      'content',
      getHostRequestScopeQueryKey(hostId),
      workspaceId,
      repoId,
      path,
    ] as const,
};
