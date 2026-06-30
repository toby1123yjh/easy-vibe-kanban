import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { workspacesApi } from '@/shared/lib/api';
import { useHostId } from '@/shared/providers/HostIdProvider';
import type { WorkspaceFileEntry } from 'shared/types';
import { workspaceFileKeys } from './workspaceFileKeys';
import {
  getWorkspaceFileNodeId,
  mapWorkspaceFileRepos,
} from './workspaceFileTree';

export function useWorkspaceFileTree(workspaceId?: string) {
  const hostId = useHostId();
  const queryClient = useQueryClient();
  const [directoryEntries, setDirectoryEntries] = useState<
    Map<string, WorkspaceFileEntry[]>
  >(new Map());
  const [truncatedDirectories, setTruncatedDirectories] = useState<Set<string>>(
    new Set()
  );
  const [loadingDirectoryKeys, setLoadingDirectoryKeys] = useState<Set<string>>(
    new Set()
  );
  const [directoryErrors, setDirectoryErrors] = useState<Map<string, Error>>(
    new Map()
  );

  const treeQuery = useQuery({
    queryKey: workspaceFileKeys.tree(workspaceId, hostId),
    queryFn: () => workspacesApi.files.tree(workspaceId!),
    enabled: !!workspaceId,
  });

  const repos = useMemo(
    () =>
      mapWorkspaceFileRepos(
        treeQuery.data?.repos ?? [],
        directoryEntries,
        truncatedDirectories
      ),
    [directoryEntries, treeQuery.data?.repos, truncatedDirectories]
  );

  const loadDirectory = useCallback(
    async (repoId: string, path: string) => {
      if (!workspaceId) return;

      const key = getWorkspaceFileNodeId(repoId, path);
      if (directoryEntries.has(key) || loadingDirectoryKeys.has(key)) return;

      setLoadingDirectoryKeys((prev) => new Set(prev).add(key));
      setDirectoryErrors((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });

      try {
        const directory = await queryClient.fetchQuery({
          queryKey: workspaceFileKeys.directory(
            workspaceId,
            repoId,
            path,
            hostId
          ),
          queryFn: () =>
            workspacesApi.files.directory(workspaceId, { repoId, path }),
        });

        setDirectoryEntries((prev) => {
          const next = new Map(prev);
          next.set(key, directory.entries);
          return next;
        });
        setTruncatedDirectories((prev) => {
          const next = new Set(prev);
          if (directory.truncated) {
            next.add(key);
          } else {
            next.delete(key);
          }
          return next;
        });
      } catch (error) {
        const normalizedError =
          error instanceof Error
            ? error
            : new Error('Failed to load directory');
        setDirectoryErrors((prev) => new Map(prev).set(key, normalizedError));
      } finally {
        setLoadingDirectoryKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [directoryEntries, hostId, loadingDirectoryKeys, queryClient, workspaceId]
  );

  const refreshTree = useCallback(async () => {
    setDirectoryEntries(new Map());
    setTruncatedDirectories(new Set());
    setDirectoryErrors(new Map());
    await treeQuery.refetch();
  }, [treeQuery]);

  return {
    repos,
    isLoading: treeQuery.isLoading,
    isFetching: treeQuery.isFetching,
    error: treeQuery.error,
    refetch: refreshTree,
    loadDirectory,
    loadingDirectoryKeys,
    directoryErrors,
  } as const;
}
