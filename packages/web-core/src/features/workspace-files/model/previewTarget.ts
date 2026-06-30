import type { WorkspaceFilePreviewTarget } from './types';

export function normalizeWorkspaceFilePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

export function getWorkspaceFileTargetKey(
  target: Pick<WorkspaceFilePreviewTarget, 'workspaceId' | 'repoId' | 'path'>
): string {
  return [
    target.workspaceId,
    target.repoId,
    normalizeWorkspaceFilePath(target.path),
  ].join(':');
}

export function isSameWorkspaceFileTarget(
  left: WorkspaceFilePreviewTarget | null | undefined,
  right: WorkspaceFilePreviewTarget | null | undefined
): boolean {
  if (!left || !right) return false;

  return getWorkspaceFileTargetKey(left) === getWorkspaceFileTargetKey(right);
}
