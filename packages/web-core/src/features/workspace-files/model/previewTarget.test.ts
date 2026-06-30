import { describe, expect, it } from 'vitest';
import {
  getWorkspaceFileTargetKey,
  isSameWorkspaceFileTarget,
  normalizeWorkspaceFilePath,
} from './previewTarget';
import type { WorkspaceFilePreviewTarget } from './types';

const target: WorkspaceFilePreviewTarget = {
  workspaceId: 'workspace-1',
  repoId: 'repo-1',
  path: 'src/app.ts',
  source: 'file-tree',
};

describe('workspace file preview target identity', () => {
  it('normalizes slashes and trims leading/trailing separators', () => {
    expect(normalizeWorkspaceFilePath('\\src\\app.ts\\')).toBe('src/app.ts');
  });

  it('keys identity by workspace, repo, and normalized path', () => {
    expect(
      getWorkspaceFileTargetKey({
        workspaceId: 'workspace-1',
        repoId: 'repo-1',
        path: '\\src\\app.ts',
      })
    ).toBe('workspace-1:repo-1:src/app.ts');
  });

  it('ignores source and session attribution when comparing targets', () => {
    expect(
      isSameWorkspaceFileTarget(target, {
        ...target,
        source: 'workflow',
        sessionId: 'session-1',
        path: '\\src\\app.ts',
      })
    ).toBe(true);
  });

  it('treats a different repo path as a different active file', () => {
    expect(
      isSameWorkspaceFileTarget(target, {
        ...target,
        repoId: 'repo-2',
      })
    ).toBe(false);
  });
});
