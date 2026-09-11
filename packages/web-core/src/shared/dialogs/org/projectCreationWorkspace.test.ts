import { test, expect } from '@playwright/test';
import type { Repo } from 'shared/types';
import type { SettingsHostTarget } from '@/shared/dialogs/settings/settings/SettingsHostContext';
import {
  canUseProjectCreationHost,
  workspaceSelectionDefault,
} from './projectCreationWorkspace';

const local: SettingsHostTarget = {
  id: 'local',
  apiHostId: null,
  kind: 'local',
  label: 'This machine',
};
const remote: SettingsHostTarget = {
  id: 'remote-a',
  apiHostId: 'remote-a',
  kind: 'remote',
  label: 'Remote A',
  status: 'online',
};

test.describe('project creation working location', () => {
  test('allows Local independently of remote host discovery', () => {
    expect(canUseProjectCreationHost(local)).toBe(true);
  });
  test('never falls back to Local when the selected machine is missing', () => {
    expect(canUseProjectCreationHost(null, 'remote-a')).toBe(false);
    expect(canUseProjectCreationHost(local, 'remote-a')).toBe(false);
  });
  test('rejects stale picker results after changing machine', () => {
    expect(canUseProjectCreationHost(remote, 'remote-b')).toBe(false);
    expect(canUseProjectCreationHost(remote, 'remote-a')).toBe(true);
  });
  test('rejects offline and unresolved remote hosts', () => {
    expect(canUseProjectCreationHost({ ...remote, status: 'offline' })).toBe(
      false
    );
    expect(canUseProjectCreationHost({ ...remote, status: undefined })).toBe(
      false
    );
  });
  test('stores an ordinary directory without a repository or branch', () => {
    expect(
      workspaceSelectionDefault({ mode: 'direct_folder', path: 'F:\\notes' })
    ).toEqual({ kind: 'direct_folder', path: 'F:\\notes' });
  });
  test('stores Git branch defaults without an execution mode', () => {
    expect(
      workspaceSelectionDefault({
        mode: 'worktree',
        path: 'F:\\repo',
        repo: { id: 'repo-a' } as Repo,
        targetBranch: 'main',
      })
    ).toEqual({
      kind: 'git',
      repo: { repo_id: 'repo-a', target_branch: 'main' },
    });
  });
});
