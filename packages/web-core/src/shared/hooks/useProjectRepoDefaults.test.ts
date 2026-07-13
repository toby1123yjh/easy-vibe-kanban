import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, scratchApi } from '@/shared/lib/api';
import {
  getProjectRepoDefaults,
  getProjectRepoDefaultsOrThrow,
  getValidProjectRepoDefaults,
  saveProjectRepoDefaults,
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

describe('project repo defaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the configured repository and branch', async () => {
    mockScratchGet.mockResolvedValue({
      payload: {
        type: 'PROJECT_REPO_DEFAULTS',
        data: {
          repos: [{ repo_id: 'repo-1', target_branch: 'main' }],
        },
      },
    } as never);

    await expect(
      getProjectRepoDefaultsOrThrow('project-1', 'host-1')
    ).resolves.toEqual([{ repo_id: 'repo-1', target_branch: 'main' }]);
    expect(mockScratchGet).toHaveBeenCalledWith(
      'PROJECT_REPO_DEFAULTS',
      'project-1',
      'host-1'
    );
  });

  it('treats a missing project setting as unconfigured', async () => {
    mockScratchGet.mockRejectedValue(new ApiError('Not found', 404));

    await expect(
      getProjectRepoDefaultsOrThrow('project-1')
    ).resolves.toBeNull();
  });

  it('preserves read failures for visible UI without changing lenient callers', async () => {
    const failure = new ApiError('Unavailable', 503);
    mockScratchGet.mockRejectedValue(failure);

    await expect(getProjectRepoDefaultsOrThrow('project-1')).rejects.toBe(
      failure
    );

    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    mockScratchGet.mockRejectedValue(failure);
    await expect(getProjectRepoDefaults('project-1')).resolves.toBeNull();
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });

  it('normalizes legacy defaults and new writes to one repository', async () => {
    mockScratchGet.mockResolvedValue({
      payload: {
        type: 'PROJECT_REPO_DEFAULTS',
        data: {
          repos: [
            { repo_id: 'repo-1', target_branch: 'main' },
            { repo_id: 'repo-2', target_branch: 'develop' },
          ],
        },
      },
    } as never);

    await expect(
      getValidProjectRepoDefaults(
        'project-1',
        new Set(['repo-1', 'repo-2']),
        'host-1'
      )
    ).resolves.toEqual([{ repo_id: 'repo-1', target_branch: 'main' }]);

    await saveProjectRepoDefaults(
      'project-1',
      [
        { repo_id: 'repo-1', target_branch: 'main' },
        { repo_id: 'repo-2', target_branch: 'develop' },
      ],
      'host-1'
    );

    expect(mockScratchUpdate).toHaveBeenCalledWith(
      'PROJECT_REPO_DEFAULTS',
      'project-1',
      {
        payload: {
          type: 'PROJECT_REPO_DEFAULTS',
          data: {
            repos: [{ repo_id: 'repo-1', target_branch: 'main' }],
          },
        },
      },
      'host-1'
    );
  });
});
