import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, scratchApi } from '@/shared/lib/api';
import {
  areProjectWorkspaceDefaultsEqual,
  getProjectWorkspaceDefault,
  getProjectWorkspaceDefaultOrThrow,
  getValidProjectWorkspaceDefault,
  normalizeProjectWorkspaceDefault,
  projectWorkspaceDefaultQueryKey,
  saveProjectWorkspaceDefault,
} from '@/shared/hooks/useProjectRepoDefaults';

vi.mock('@/shared/lib/api', () => {
  class MockApiError extends Error {
    public status?: number;

    constructor(message: string, status?: number) {
      super(message);
      this.status = status;
    }
  }

  return {
    ApiError: MockApiError,
    scratchApi: {
      get: vi.fn(),
      update: vi.fn(),
    },
  };
});

const mockScratchGet = vi.mocked(scratchApi.get);
const mockScratchUpdate = vi.mocked(scratchApi.update);

describe('project workspace defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads an existing Git repository default', async () => {
    mockScratchGet.mockResolvedValue({
      payload: {
        type: 'PROJECT_REPO_DEFAULTS',
        data: {
          repos: [{ repo_id: 'repo-1', target_branch: 'main' }],
          directory_path: null,
        },
      },
    } as never);

    await expect(
      getProjectWorkspaceDefaultOrThrow('project-1', 'host-1')
    ).resolves.toEqual({
      kind: 'git',
      repo: { repo_id: 'repo-1', target_branch: 'main' },
    });
    expect(mockScratchGet).toHaveBeenCalledWith(
      'PROJECT_REPO_DEFAULTS',
      'project-1',
      'host-1'
    );
  });

  it('normalizes an ordinary directory and gives it precedence', () => {
    expect(
      normalizeProjectWorkspaceDefault({
        repos: [{ repo_id: 'repo-1', target_branch: 'main' }],
        directory_path: '  F:\\notes  ',
      })
    ).toEqual({ kind: 'direct_folder', path: 'F:\\notes' });
  });

  it('scopes the display cache by host and project', () => {
    expect(projectWorkspaceDefaultQueryKey('project-1')).toEqual([
      'project-workspace-default',
      'local',
      'project-1',
    ]);
    expect(projectWorkspaceDefaultQueryKey('project-1', 'host-1')).toEqual([
      'project-workspace-default',
      'host-1',
      'project-1',
    ]);
  });

  it('detects changes across both workspace shapes', () => {
    const gitDefault = {
      kind: 'git' as const,
      repo: { repo_id: 'repo-1', target_branch: 'main' },
    };
    const directDefault = {
      kind: 'direct_folder' as const,
      path: 'F:\\notes',
    };

    expect(areProjectWorkspaceDefaultsEqual(gitDefault, gitDefault)).toBe(true);
    expect(
      areProjectWorkspaceDefaultsEqual(gitDefault, {
        ...gitDefault,
        repo: { ...gitDefault.repo, target_branch: 'develop' },
      })
    ).toBe(false);
    expect(
      areProjectWorkspaceDefaultsEqual(directDefault, {
        ...directDefault,
        path: 'F:\\other',
      })
    ).toBe(false);
    expect(areProjectWorkspaceDefaultsEqual(gitDefault, directDefault)).toBe(
      false
    );
    expect(areProjectWorkspaceDefaultsEqual(null, null)).toBe(true);
  });

  it('treats a missing project setting as unconfigured', async () => {
    mockScratchGet.mockRejectedValue(new ApiError('Not found', 404));

    await expect(
      getProjectWorkspaceDefaultOrThrow('project-1')
    ).resolves.toBeNull();
  });

  it('preserves read failures for visible UI without changing lenient callers', async () => {
    const failure = new ApiError('Unavailable', 503);
    mockScratchGet.mockRejectedValue(failure);

    await expect(getProjectWorkspaceDefaultOrThrow('project-1')).rejects.toBe(
      failure
    );

    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mockScratchGet.mockRejectedValue(failure);
    await expect(getProjectWorkspaceDefault('project-1')).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it('filters stale Git repos but keeps ordinary directories', async () => {
    mockScratchGet
      .mockResolvedValueOnce({
        payload: {
          type: 'PROJECT_REPO_DEFAULTS',
          data: {
            repos: [{ repo_id: 'repo-1', target_branch: 'main' }],
            directory_path: null,
          },
        },
      } as never)
      .mockResolvedValueOnce({
        payload: {
          type: 'PROJECT_REPO_DEFAULTS',
          data: { repos: [], directory_path: 'F:\\notes' },
        },
      } as never);

    await expect(
      getValidProjectWorkspaceDefault('project-1', new Set(), 'host-1')
    ).resolves.toBeNull();
    await expect(
      getValidProjectWorkspaceDefault('project-1', new Set(), 'host-1')
    ).resolves.toEqual({ kind: 'direct_folder', path: 'F:\\notes' });
  });

  it('writes mutually exclusive Git and direct-folder payloads', async () => {
    await saveProjectWorkspaceDefault(
      'project-1',
      {
        kind: 'git',
        repo: { repo_id: 'repo-1', target_branch: 'main' },
      },
      'host-1'
    );
    await saveProjectWorkspaceDefault(
      'project-1',
      { kind: 'direct_folder', path: '  F:\\notes  ' },
      'host-1'
    );

    expect(mockScratchUpdate).toHaveBeenNthCalledWith(
      1,
      'PROJECT_REPO_DEFAULTS',
      'project-1',
      {
        payload: {
          type: 'PROJECT_REPO_DEFAULTS',
          data: {
            repos: [{ repo_id: 'repo-1', target_branch: 'main' }],
            directory_path: null,
          },
        },
      },
      'host-1'
    );
    expect(mockScratchUpdate).toHaveBeenNthCalledWith(
      2,
      'PROJECT_REPO_DEFAULTS',
      'project-1',
      {
        payload: {
          type: 'PROJECT_REPO_DEFAULTS',
          data: { repos: [], directory_path: 'F:\\notes' },
        },
      },
      'host-1'
    );
  });
});
