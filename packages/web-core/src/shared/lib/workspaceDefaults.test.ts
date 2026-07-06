import { beforeEach, describe, expect, it, vi } from 'vitest';
import { repoApi } from '@/shared/lib/api';
import { getValidProjectRepoDefaults } from '@/shared/hooks/useProjectRepoDefaults';
import {
  buildExplicitProjectWorkspaceDefaults,
  getExplicitProjectWorkspaceDefaults,
  getWorkspaceDefaults,
} from './workspaceDefaults';

vi.mock('@/shared/lib/api', () => ({
  repoApi: {
    list: vi.fn(),
  },
  workspacesApi: {
    getRepos: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('@/shared/hooks/useProjectRepoDefaults', () => ({
  getValidProjectRepoDefaults: vi.fn(),
}));

const mockRepoList = vi.mocked(repoApi.list);
const mockGetValidProjectRepoDefaults = vi.mocked(getValidProjectRepoDefaults);

describe('workspace defaults', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

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

  it('reads explicit project defaults from the requested host scope', async () => {
    mockRepoList.mockResolvedValue([{ id: 'repo-1' } as never]);
    mockGetValidProjectRepoDefaults.mockResolvedValue([
      { repo_id: 'repo-1', target_branch: 'main' },
    ]);

    await expect(
      getExplicitProjectWorkspaceDefaults('project-1', 'host-1')
    ).resolves.toEqual({
      preferredRepos: [{ repo_id: 'repo-1', target_branch: 'main' }],
    });

    expect(mockRepoList).toHaveBeenCalledWith('host-1');

    const [projectId, availableRepoIds, hostId] =
      mockGetValidProjectRepoDefaults.mock.calls[0];
    expect(projectId).toBe('project-1');
    expect([...availableRepoIds]).toEqual(['repo-1']);
    expect(hostId).toBe('host-1');
  });

  it('reads workspace defaults from project scratch defaults in the requested host scope', async () => {
    mockRepoList.mockResolvedValue([{ id: 'repo-1' } as never]);
    mockGetValidProjectRepoDefaults.mockResolvedValue([
      { repo_id: 'repo-1', target_branch: 'main' },
    ]);

    await expect(
      getWorkspaceDefaults([], new Set(), 'project-1', 'host-1')
    ).resolves.toEqual({
      preferredRepos: [{ repo_id: 'repo-1', target_branch: 'main' }],
    });

    expect(mockRepoList).toHaveBeenCalledWith('host-1');

    const [projectId, availableRepoIds, hostId] =
      mockGetValidProjectRepoDefaults.mock.calls[0];
    expect(projectId).toBe('project-1');
    expect([...availableRepoIds]).toEqual(['repo-1']);
    expect(hostId).toBe('host-1');
  });
});
