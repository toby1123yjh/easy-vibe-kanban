import { useCallback } from 'react';
import type { RepoWithTargetBranch } from 'shared/types';
import { normalizeWorkspaceFilePath } from './previewTarget';
import type {
  WorkspaceFilePreviewSource,
  WorkspaceFilePreviewTarget,
} from './types';

export type WorkspaceFilePreviewResolution =
  | { status: 'resolved'; target: WorkspaceFilePreviewTarget }
  | {
      status: 'ambiguous';
      path: string;
      candidates: RepoWithTargetBranch[];
    }
  | {
      status: 'unavailable';
      reason: 'no-workspace' | 'no-repo' | 'invalid-path' | 'repo-not-found';
    };

export interface ResolveWorkspaceFilePreviewTargetInput {
  workspaceId?: string | null;
  repos: RepoWithTargetBranch[];
  path: string;
  source: WorkspaceFilePreviewSource;
  sessionId?: string | null;
  repoId?: string | null;
}

function normalizeRepoNameSegment(value: string): string {
  return value.trim().toLowerCase();
}

function isUnsafeWorkspaceFilePath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return true;
  if (trimmed.startsWith('/') || trimmed.startsWith('\\')) return true;

  const normalized = normalizeWorkspaceFilePath(trimmed);
  if (!normalized) return true;
  return normalized.split('/').some((segment) => segment === '..');
}

function createTarget({
  workspaceId,
  repo,
  path,
  source,
  sessionId,
}: {
  workspaceId: string;
  repo: RepoWithTargetBranch;
  path: string;
  source: WorkspaceFilePreviewSource;
  sessionId?: string | null;
}): WorkspaceFilePreviewTarget {
  return {
    workspaceId,
    repoId: repo.id,
    path: normalizeWorkspaceFilePath(path),
    source,
    ...(sessionId ? { sessionId } : {}),
  };
}

export function resolveWorkspaceFilePreviewTarget({
  workspaceId,
  repos,
  path,
  source,
  sessionId,
  repoId,
}: ResolveWorkspaceFilePreviewTargetInput): WorkspaceFilePreviewResolution {
  if (!workspaceId) {
    return { status: 'unavailable', reason: 'no-workspace' };
  }

  if (isUnsafeWorkspaceFilePath(path)) {
    return { status: 'unavailable', reason: 'invalid-path' };
  }

  if (repos.length === 0) {
    return { status: 'unavailable', reason: 'no-repo' };
  }

  const normalizedPath = normalizeWorkspaceFilePath(path.trim());

  if (repoId) {
    const repo = repos.find((candidate) => candidate.id === repoId);
    if (!repo) {
      return { status: 'unavailable', reason: 'repo-not-found' };
    }

    return {
      status: 'resolved',
      target: createTarget({
        workspaceId,
        repo,
        path: normalizedPath,
        source,
        sessionId,
      }),
    };
  }

  if (repos.length === 1) {
    return {
      status: 'resolved',
      target: createTarget({
        workspaceId,
        repo: repos[0],
        path: normalizedPath,
        source,
        sessionId,
      }),
    };
  }

  const [firstSegment, ...restSegments] = normalizedPath.split('/');
  if (firstSegment && restSegments.length > 0) {
    const normalizedFirstSegment = normalizeRepoNameSegment(firstSegment);
    const matchingRepo = repos.find(
      (repo) =>
        normalizeRepoNameSegment(repo.name) === normalizedFirstSegment ||
        normalizeRepoNameSegment(repo.display_name) === normalizedFirstSegment
    );

    if (matchingRepo) {
      return {
        status: 'resolved',
        target: createTarget({
          workspaceId,
          repo: matchingRepo,
          path: restSegments.join('/'),
          source,
          sessionId,
        }),
      };
    }
  }

  return {
    status: 'ambiguous',
    path: normalizedPath,
    candidates: repos,
  };
}

export function useWorkspaceFilePreviewResolver(
  workspaceId: string | undefined | null,
  repos: RepoWithTargetBranch[],
  sessionId?: string | null
) {
  return useCallback(
    ({
      path,
      source,
      repoId,
    }: {
      path: string;
      source: WorkspaceFilePreviewSource;
      repoId?: string | null;
    }) =>
      resolveWorkspaceFilePreviewTarget({
        workspaceId,
        repos,
        path,
        source,
        sessionId,
        repoId,
      }),
    [repos, sessionId, workspaceId]
  );
}
