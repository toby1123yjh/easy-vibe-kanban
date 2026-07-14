import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceContext,
  joinWorkspacePath,
  resolveWorkspaceWorkingDirectory,
} from './workspaceContext';

describe('workspace context projection', () => {
  it('joins Windows and Unix workspace paths', () => {
    expect(joinWorkspacePath('F:\\workspaces', 'repo')).toBe(
      'F:\\workspaces\\repo'
    );
    expect(joinWorkspacePath('/tmp/workspaces/', '/repo')).toBe(
      '/tmp/workspaces/repo'
    );
  });

  it('resolves the exact agent working directory without Vibe history state', () => {
    expect(
      resolveWorkspaceWorkingDirectory({
        containerRef: 'F:\\workspaces',
        workingDir: 'repo',
        fallbackRepoName: 'ignored',
      })
    ).toBe('F:\\workspaces\\repo');

    expect(
      resolveWorkspaceWorkingDirectory({
        containerRef: 'F:\\source-repo',
      })
    ).toBe('F:\\source-repo');

    expect(
      resolveWorkspaceWorkingDirectory({
        containerRef: '   ',
      })
    ).toBeUndefined();
  });

  it('shows a Git direct folder without a mode label', () => {
    expect(
      buildWorkspaceContext({
        containerRef: 'F:\\repo',
        branch: 'main',
        workspaceKind: 'direct_folder',
      })
    ).toEqual([
      { kind: 'path', label: 'F:\\repo' },
      { kind: 'branch', label: 'main' },
    ]);
  });

  it('hides the non-Git direct-folder persistence sentinel', () => {
    expect(
      buildWorkspaceContext({
        containerRef: 'F:\\notes',
        branch: 'direct-folder',
        workspaceKind: 'direct_folder',
      })
    ).toEqual([{ kind: 'path', label: 'F:\\notes' }]);
  });

  it('shows the actual worktree path, branch, and marker', () => {
    expect(
      buildWorkspaceContext({
        containerRef: 'F:\\workspaces',
        workingDir: 'repo',
        branch: 'feature/workflow',
        workspaceKind: 'worktree',
      })
    ).toEqual([
      { kind: 'path', label: 'F:\\workspaces\\repo' },
      { kind: 'branch', label: 'feature/workflow' },
      { kind: 'mode', label: 'Worktree' },
    ]);
  });
});
