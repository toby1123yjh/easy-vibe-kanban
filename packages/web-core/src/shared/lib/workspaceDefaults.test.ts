import { beforeEach, describe, expect, it, vi } from 'vitest';
import { repoApi, workspacesApi } from '@/shared/lib/api';
import { getValidProjectWorkspaceDefault } from '@/shared/hooks/useProjectRepoDefaults';
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
  getValidProjectWorkspaceDefault: vi.fn(),
}));

const mockRepoList = vi.mocked(repoApi.list);
const mockGetWorkspaceRepos = vi.mocked(workspacesApi.getRepos);
const mockGetValidProjectWorkspaceDefault = vi.mocked(
  getValidProjectWorkspaceDefault
);

describe('workspace defaults', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('builds a Git project prefill', () => {
    expect(
      buildExplicitProjectWorkspaceDefaults({
        kind: 'git',
        repo: { repo_id: 'repo-1', target_branch: 'main' },
      })
    ).toEqual({
      preferredRepos: [{ repo_id: 'repo-1', target_branch: 'main' }],
      preferredDirectoryPath: null,
    });
  });

  it('builds an ordinary-directory project prefill', () => {
    expect(
      buildExplicitProjectWorkspaceDefaults({
        kind: 'direct_folder',
        path: ' F:\\notes ',
      })
    ).toEqual({
      preferredRepos: [],
      preferredDirectoryPath: 'F:\\notes',
    });
  });

  it('rejects invalid explicit defaults', () => {
    expect(
      buildExplicitProjectWorkspaceDefaults({
        kind: 'git',
        repo: { repo_id: 'repo-1', target_branch: '  ' },
      })
    ).toBeNull();
    expect(
      buildExplicitProjectWorkspaceDefaults({
        kind: 'direct_folder',
        path: '  ',
      })
    ).toBeNull();
    expect(buildExplicitProjectWorkspaceDefaults(null)).toBeNull();
  });

  it('reads explicit project defaults from the requested host scope', async () => {
    mockRepoList.mockResolvedValue([{ id: 'repo-1' } as never]);
    mockGetValidProjectWorkspaceDefault.mockResolvedValue({
      kind: 'git',
      repo: { repo_id: 'repo-1', target_branch: 'main' },
    });

    await expect(
      getExplicitProjectWorkspaceDefaults('project-1', 'host-1')
    ).resolves.toEqual({
      preferredRepos: [{ repo_id: 'repo-1', target_branch: 'main' }],
      preferredDirectoryPath: null,
    });

    expect(mockRepoList).toHaveBeenCalledWith('host-1');

    const [projectId, availableRepoIds, hostId] =
      mockGetValidProjectWorkspaceDefault.mock.calls[0];
    expect(projectId).toBe('project-1');
    expect([...availableRepoIds]).toEqual(['repo-1']);
    expect(hostId).toBe('host-1');
  });

  it('reads a direct project workspace default in the requested host scope', async () => {
    mockRepoList.mockResolvedValue([]);
    mockGetValidProjectWorkspaceDefault.mockResolvedValue({
      kind: 'direct_folder',
      path: 'F:\\notes',
    });

    await expect(
      getWorkspaceDefaults([], new Set(), 'project-1', 'host-1')
    ).resolves.toEqual({
      preferredRepos: [],
      preferredDirectoryPath: 'F:\\notes',
    });
  });

  it('does not infer project defaults from workspace history', async () => {
    mockRepoList.mockResolvedValue([]);
    mockGetValidProjectWorkspaceDefault.mockResolvedValue(null);

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
      preferredDirectoryPath: null,
    });

    expect(mockGetWorkspaceRepos).toHaveBeenCalledWith('global-workspace');
  });
});
