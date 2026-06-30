import { describe, expect, it } from 'vitest';
import type { RepoWithTargetBranch } from 'shared/types';
import { resolveWorkspaceFilePreviewTarget } from './useWorkspaceFilePreviewResolver';

const repo = (
  id: string,
  name: string,
  displayName = name
): RepoWithTargetBranch =>
  ({
    id,
    name,
    display_name: displayName,
  }) as RepoWithTargetBranch;

describe('workspace file preview path resolution', () => {
  it('rejects unsafe paths before creating a target', () => {
    const repos = [repo('repo-1', 'app')];

    expect(
      resolveWorkspaceFilePreviewTarget({
        workspaceId: 'workspace-1',
        repos,
        path: '../secret.txt',
        source: 'chat',
      })
    ).toEqual({ status: 'unavailable', reason: 'invalid-path' });

    expect(
      resolveWorkspaceFilePreviewTarget({
        workspaceId: 'workspace-1',
        repos,
        path: 'C:\\Users\\secret.txt',
        source: 'chat',
      })
    ).toEqual({ status: 'unavailable', reason: 'invalid-path' });

    expect(
      resolveWorkspaceFilePreviewTarget({
        workspaceId: 'workspace-1',
        repos,
        path: 'https://example.com/file.ts',
        source: 'chat',
      })
    ).toEqual({ status: 'unavailable', reason: 'invalid-path' });
  });

  it('uses an explicit repo id when it belongs to the workspace repos', () => {
    const result = resolveWorkspaceFilePreviewTarget({
      workspaceId: 'workspace-1',
      repos: [repo('repo-1', 'app'), repo('repo-2', 'api')],
      repoId: 'repo-2',
      path: 'src/server.ts',
      source: 'workflow',
      sessionId: 'session-1',
    });

    expect(result).toEqual({
      status: 'resolved',
      target: {
        workspaceId: 'workspace-1',
        repoId: 'repo-2',
        path: 'src/server.ts',
        source: 'workflow',
        sessionId: 'session-1',
      },
    });
  });

  it('uses the only repo in a single-repo workspace', () => {
    const result = resolveWorkspaceFilePreviewTarget({
      workspaceId: 'workspace-1',
      repos: [repo('repo-1', 'app')],
      path: 'src\\app.tsx\\',
      source: 'chat',
    });

    expect(result).toEqual({
      status: 'resolved',
      target: {
        workspaceId: 'workspace-1',
        repoId: 'repo-1',
        path: 'src/app.tsx',
        source: 'chat',
      },
    });
  });

  it('resolves multi-repo paths with a repo name prefix', () => {
    const result = resolveWorkspaceFilePreviewTarget({
      workspaceId: 'workspace-1',
      repos: [repo('repo-1', 'app'), repo('repo-2', 'api', 'Backend API')],
      path: 'Backend API/src/server.ts',
      source: 'diff',
    });

    expect(result).toEqual({
      status: 'resolved',
      target: {
        workspaceId: 'workspace-1',
        repoId: 'repo-2',
        path: 'src/server.ts',
        source: 'diff',
      },
    });
  });

  it('returns ambiguous instead of guessing in multi-repo workspaces', () => {
    const repos = [repo('repo-1', 'app'), repo('repo-2', 'api')];
    const result = resolveWorkspaceFilePreviewTarget({
      workspaceId: 'workspace-1',
      repos,
      path: 'src/index.ts',
      source: 'chat',
    });

    expect(result).toEqual({
      status: 'ambiguous',
      path: 'src/index.ts',
      candidates: repos,
    });
  });
});
