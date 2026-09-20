import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppShellProjects } from '@/shared/hooks/useAppShellProjects';
import { getProjectWorkspaceDefaultOrThrow } from '@/shared/hooks/useProjectRepoDefaults';
import { executionDataApi } from '@/shared/lib/executionDataApi';
import { repoApi } from '@/shared/lib/api';
import { DEFAULT_PROJECT_ID } from '@/shared/lib/defaultProject';
import type { Repo } from 'shared/types';

export type SessionProjectTarget =
  | { mode: 'managed_directory' }
  | { mode: 'direct_folder'; path: string }
  | { mode: 'worktree'; repo: Repo; branch: string };

export function useSessionProjectTarget(
  hostId: string | null,
  initialProjectId?: string,
  issueProjectId?: string
) {
  const shell = useAppShellProjects();
  const selectionScope = `${hostId ?? 'local'}:${initialProjectId ?? DEFAULT_PROJECT_ID}:${issueProjectId ?? ''}`;
  const [selection, setSelection] = useState({
    scope: selectionScope,
    id: initialProjectId ?? DEFAULT_PROJECT_ID,
  });
  const projectId =
    issueProjectId ??
    (selection.scope === selectionScope
      ? selection.id
      : (initialProjectId ?? DEFAULT_PROJECT_ID));
  const enabled = !(shell?.deployment === 'remote' && !hostId);
  const projects = useQuery({
    queryKey: ['session-project-choices', hostId ?? 'local'],
    enabled,
    queryFn: async ({ signal }) => {
      const first = await executionDataApi.listProjects({
        hostId,
        signal,
        limit: 100,
      });
      const items = [...first.projects];
      let cursor = first.next_cursor;
      while (cursor) {
        const page = await executionDataApi.listProjects({
          hostId,
          signal,
          limit: 100,
          cursor,
        });
        items.push(...page.projects);
        cursor = page.next_cursor;
      }
      return items;
    },
  });
  const exists =
    projects.data?.some((project) => project.id === projectId) ?? false;
  const target = useQuery({
    queryKey: ['session-project-target', hostId ?? 'local', projectId],
    enabled: enabled && exists,
    // Never carry a previous project's directory into the next selection.
    queryFn: async (): Promise<SessionProjectTarget | null> => {
      if (projectId === DEFAULT_PROJECT_ID)
        return { mode: 'managed_directory' };
      const workspace = await getProjectWorkspaceDefaultOrThrow(
        projectId,
        hostId
      );
      if (!workspace) return null;
      if (workspace.kind === 'direct_folder')
        return { mode: 'direct_folder', path: workspace.path };
      if (!workspace.repo.target_branch?.trim()) return null;
      const repo = await repoApi.getById(workspace.repo.repo_id, hostId);
      return { mode: 'worktree', repo, branch: workspace.repo.target_branch };
    },
  });
  return {
    projectId,
    projects,
    target,
    enabled,
    exists,
    ready:
      enabled &&
      exists &&
      !projects.isError &&
      !target.isFetching &&
      !target.isError &&
      !!target.data,
    selectProject(id: string) {
      setSelection({ scope: selectionScope, id });
    },
  };
}
