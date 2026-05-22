import { describe, expect, it } from 'vitest';
import { buildExplicitProjectWorkspaceDefaults } from './workspaceDefaults';

describe('workspace defaults', () => {
  it('builds explicit project workspace defaults when repos have branches', () => {
    expect(
      buildExplicitProjectWorkspaceDefaults([
        { repo_id: 'repo-1', target_branch: 'main' },
        { repo_id: 'repo-2', target_branch: 'develop' },
      ])
    ).toEqual({
      preferredRepos: [
        { repo_id: 'repo-1', target_branch: 'main' },
        { repo_id: 'repo-2', target_branch: 'develop' },
      ],
    });
  });

  it('does not build defaults when any repo is missing a branch', () => {
    expect(
      buildExplicitProjectWorkspaceDefaults([
        { repo_id: 'repo-1', target_branch: 'main' },
        { repo_id: 'repo-2', target_branch: '  ' },
      ])
    ).toBeNull();
  });

  it('does not build defaults from an empty repo list', () => {
    expect(buildExplicitProjectWorkspaceDefaults([])).toBeNull();
  });
});
