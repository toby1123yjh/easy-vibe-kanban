import { describe, expect, it } from 'vitest';
import {
  buildWorkspaceCreateInitialState,
  toDraftWorkspaceData,
} from './workspaceCreateState';

describe('workspace create direct-folder state', () => {
  it('carries a project directory prefill into the persisted draft contract', () => {
    const initialState = buildWorkspaceCreateInitialState({
      prompt: 'Fix the issue',
      defaults: {
        preferredRepos: [],
        preferredDirectoryPath: 'F:\\notes',
      },
    });

    expect(initialState.preferredDirectoryPath).toBe('F:\\notes');
    expect(toDraftWorkspaceData(initialState)).toMatchObject({
      message: 'Fix the issue',
      repos: [],
      directory_path: 'F:\\notes',
    });
  });
});
