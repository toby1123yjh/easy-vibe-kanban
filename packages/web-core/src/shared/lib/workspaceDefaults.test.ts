import { beforeEach, describe, expect, it, vi } from 'vitest';
import { repoApi, workspacesApi } from '@/shared/lib/api';
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
const mockGetWorkspaceRepos = vi.mocked(workspacesApi.getRepos);
const mockGetValidProjectRepoDefaults = vi.mocked(getValidProjectRepoDefaults);

describe('workspace defaults', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('normalizes legacy project defaults to one repository', () => {
    expect(
      buildExplicitProjectWorkspaceDefaults([
        { repo_id: 'repo-1', target_branch: 'main' },
        { repo_id: 'repo-2', target_branch: 'develop' },
      ])
    ).toEqual({
      preferredRepos: [{ repo_id: 'repo-1', target_branch: 'main' }],
    });
  });

  it('ignores invalid trailing legacy entries after the first repository', () => {
    expect(
      buildExplicitProjectWorkspaceDefaults([
        { repo_id: 'repo-1', target_branch: 'main' },
        { repo_id: 'repo-2', target_branch: '  ' },
      ])
    ).toEqual({
      preferredRepos: [{ repo_id: 'repo-1', target_branch: 'main' }],
    });
  });

  it('rejects a project default whose selected branch is blank', () => {
    expect(
      buildExplicitProjectWorkspaceDefaults([
        { repo_id: 'repo-1', target_branch: '  ' },
        { repo_id: 'repo-2', target_branch: 'develop' },
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

  it('does not infer project defaults from workspace history', async () => {
    mockRepoList.mockResolvedValue([]);
    mockGetValidProjectRepoDefaults.mockResolvedValue([]);

    await expect(
      getWorkspaceDefaults(
        [
          {
            project_id: 'current-project',
            local_workspace_id: 'project-workspace',
            updated_at: '2026-07-12T12:00:00.000Z',
          } as never,
          {
            project_id: 'unrelated-project',
            local_workspace_id: 'global-workspace',
            updated_at: '2026-07-12T13:00:00.000Z',
          } as never,
        ],
        new Set(['project-workspace', 'global-workspace']),
        'current-project'
      )
    ).resolves.toBeNull();

    expect(mockGetWorkspaceRepos).not.toHaveBeenCalled();
  });

  it('keeps the globally recent workspace prefill for standalone creation', async () => {
    mockGetWorkspaceRepos.mockResolvedValue([
      { id: 'repo-1', target_branch: 'main' } as never,
    ]);

    await expect(
      getWorkspaceDefaults(
        [
          {
            local_workspace_id: 'global-workspace',
            updated_at: '2026-07-12T12:00:00.000Z',
          } as never,
        ],
        new Set(['global-workspace'])
      )
    ).resolves.toEqual({
      preferredRepos: [{ repo_id: 'repo-1', target_branch: 'main' }],
    });

    expect(mockGetWorkspaceRepos).toHaveBeenCalledWith('global-workspace');
  });
});
