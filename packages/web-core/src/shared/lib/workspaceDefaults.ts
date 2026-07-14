import { workspacesApi, repoApi } from '@/shared/lib/api';
import type { Workspace } from 'shared/remote-types';
import {
  getValidProjectWorkspaceDefault,
  type ProjectWorkspaceDefault,
} from '@/shared/hooks/useProjectRepoDefaults';

export interface WorkspaceDefaults {
  preferredRepos: Array<{ repo_id: string; target_branch: string | null }>;
  preferredDirectoryPath: string | null;
}

export function buildExplicitProjectWorkspaceDefaults(
  workspaceDefault: ProjectWorkspaceDefault | null
): WorkspaceDefaults | null {
  if (workspaceDefault?.kind === 'direct_folder') {
    const path = workspaceDefault.path.trim();
    return path ? { preferredRepos: [], preferredDirectoryPath: path } : null;
  }

  if (
    workspaceDefault?.kind !== 'git' ||
    !workspaceDefault.repo.target_branch.trim()
  ) {
    return null;
  }

  return {
    preferredRepos: [
      {
        repo_id: workspaceDefault.repo.repo_id,
        target_branch: workspaceDefault.repo.target_branch,
      },
    ],
    preferredDirectoryPath: null,
  };
}

/**
 * Fetches only explicit project repo defaults saved for this project.
 * Unlike getWorkspaceDefaults(), this never falls back to recent workspaces,
 * so callers can safely skip a repository picker without borrowing repos from
 * an unrelated project.
 */
export async function getExplicitProjectWorkspaceDefaults(
  projectId: string,
  hostId?: string | null
): Promise<WorkspaceDefaults | null> {
  const allRepos = await repoApi.list(hostId);
  const availableRepoIds = new Set(allRepos.map((r) => r.id));
  const scratchDefault = await getValidProjectWorkspaceDefault(
    projectId,
    availableRepoIds,
    hostId
  );

  return buildExplicitProjectWorkspaceDefaults(scratchDefault);
}

/**
 * Fetches workspace creation defaults using a project-aware priority chain:
 * 1. Scratch project-repo defaults (if projectId provided and valid repos exist)
 * 2. null for project-scoped creation
 * 3. Globally most recent workspace only for standalone creation
 * 4. null (no defaults)
 */
export async function getWorkspaceDefaults(
  remoteWorkspaces: Workspace[],
  localWorkspaceIds: Set<string>,
  projectId?: string | null,
  hostId?: string | null
): Promise<WorkspaceDefaults | null> {
  // Priority 1: Scratch project-repo defaults
  if (projectId) {
    try {
      const allRepos = await repoApi.list(hostId);
      const availableRepoIds = new Set(allRepos.map((r) => r.id));
      const scratchDefault = await getValidProjectWorkspaceDefault(
        projectId,
        availableRepoIds,
        hostId
      );
      const explicitDefaults =
        buildExplicitProjectWorkspaceDefaults(scratchDefault);
      if (explicitDefaults) {
        return explicitDefaults;
      }
    } catch (err) {
      console.warn('Failed to fetch project scratch defaults:', err);
    }

    // A project-linked issue does not own a workspace. Only the project's
    // visible, explicit setting may prefill execution creation; workspace
    // history would otherwise become hidden project state.
    return null;
  }

  // Standalone creation may use the globally most recent workspace as a
  // convenience prefill because there is no project boundary to preserve.
  const mostRecent = remoteWorkspaces
    .filter(
      (w) =>
        w.local_workspace_id !== null &&
        localWorkspaceIds.has(w.local_workspace_id)
    )
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    )[0];

  if (!mostRecent?.local_workspace_id) {
    return null;
  }

  try {
    const [repos] = await Promise.all([
      workspacesApi.getRepos(mostRecent.local_workspace_id),
      workspacesApi.get(mostRecent.local_workspace_id),
    ]);

    return {
      preferredRepos: repos.map((r) => ({
        repo_id: r.id,
        target_branch: r.target_branch,
      })),
      preferredDirectoryPath: null,
    };
  } catch (err) {
    console.warn('Failed to fetch workspace defaults:', err);
    return null;
  }
}
