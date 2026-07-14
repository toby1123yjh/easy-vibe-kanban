import { describe, expect, it, vi } from 'vitest';
import { resolveCreateModeBootstrap } from './createModeBootstrap';

vi.mock('@/shared/lib/api', () => ({
  repoApi: { getById: vi.fn() },
}));

const isValidProfile = () => true;

describe('create mode bootstrap direct folders', () => {
  it('restores a preferred direct folder from seed state', async () => {
    await expect(
      resolveCreateModeBootstrap({
        seedState: {
          preferredDirectoryPath: '  F:\\notes  ',
          preferredRepos: [{ repo_id: 'ignored-repo', target_branch: 'main' }],
        },
        isValidProfile,
      })
    ).resolves.toEqual({
      source: 'seed',
      data: { directFolderPath: 'F:\\notes' },
    });
  });

  it('restores a direct folder from a persisted create draft', async () => {
    await expect(
      resolveCreateModeBootstrap({
        seedState: null,
        scratchData: {
          message: '',
          repos: [],
          directory_path: 'F:\\notes',
          executor_config: null,
          linked_issue: null,
          attachments: [],
        },
        isValidProfile,
      })
    ).resolves.toEqual({
      source: 'scratch',
      data: { directFolderPath: 'F:\\notes' },
    });
  });
});
