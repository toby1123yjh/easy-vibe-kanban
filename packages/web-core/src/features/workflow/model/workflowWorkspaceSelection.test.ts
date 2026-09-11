import { test, expect } from '@playwright/test';
import type { Repo } from 'shared/types';
import {
  workflowWorkspaceInput,
  workflowDraftWorkspaceInput,
} from './workflowWorkspaceSelection';

test('confirmed folder propagates without a repository or worktree', () => {
  const input = workflowWorkspaceInput({
    mode: 'direct_folder',
    path: 'F:\\notes',
  });
  expect(input).toEqual({ repos: [], directory_path: 'F:\\notes' });
  const restoredDraft = JSON.parse(
    JSON.stringify({ repos: input.repos, directoryPath: input.directory_path })
  );
  expect(workflowDraftWorkspaceInput(restoredDraft)).toEqual(input);
});

test('Git worktree preserves repo and target branch without a directory', () => {
  expect(
    workflowWorkspaceInput({
      mode: 'worktree',
      path: 'F:\\repo',
      repo: { id: 'repo-a' } as Repo,
      targetBranch: 'main',
    })
  ).toEqual({ repos: [{ repo_id: 'repo-a', target_branch: 'main' }] });
});

test('draft directory takes precedence over leftover repository data', () => {
  expect(
    workflowDraftWorkspaceInput({
      repos: [{ repo_id: 'old', target_branch: 'main' }],
      directoryPath: ' F:\\notes ',
    })
  ).toEqual({ repos: [], directory_path: 'F:\\notes' });
});

test('unconfigured draft still requests confirmation', () => {
  expect(workflowDraftWorkspaceInput({ repos: [] })).toEqual({ repos: [] });
});
