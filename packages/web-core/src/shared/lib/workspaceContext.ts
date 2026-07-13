import type { WorkspaceKind } from 'shared/types';

export type WorkspaceContextPartKind = 'path' | 'branch' | 'mode';

export interface WorkspaceContextPart {
  kind: WorkspaceContextPartKind;
  label: string;
}

export interface BuildWorkspaceContextOptions {
  containerRef?: string | null;
  workingDir?: string | null;
  fallbackRepoName?: string | null;
  branch?: string | null;
  workspaceKind?: WorkspaceKind | null;
  worktreeLabel?: string;
}

export function joinWorkspacePath(
  containerRef: string,
  workingDir?: string | null
) {
  const relativePath = workingDir?.trim().replace(/^[\\/]+/, '');
  if (!relativePath) return containerRef;

  const separator = containerRef.includes('\\') ? '\\' : '/';
  const basePath = containerRef.replace(/[\\/]+$/, '');
  if (!basePath) return `${separator}${relativePath}`;

  return `${basePath}${separator}${relativePath}`;
}

export function buildWorkspaceContext({
  containerRef,
  workingDir,
  fallbackRepoName,
  branch,
  workspaceKind,
  worktreeLabel = 'Worktree',
}: BuildWorkspaceContextOptions): WorkspaceContextPart[] {
  const parts: WorkspaceContextPart[] = [];
  const normalizedContainerRef = containerRef?.trim();

  if (normalizedContainerRef) {
    parts.push({
      kind: 'path',
      label: joinWorkspacePath(
        normalizedContainerRef,
        workingDir?.trim() || fallbackRepoName?.trim()
      ),
    });
  }

  const normalizedBranch = branch?.trim();
  if (normalizedBranch && normalizedBranch !== 'direct-folder') {
    parts.push({ kind: 'branch', label: normalizedBranch });
  }

  if (workspaceKind === 'worktree') {
    parts.push({ kind: 'mode', label: worktreeLabel });
  }

  return parts;
}
