import { expect, test } from '@playwright/test';
import { deriveWorkspaceDetailState } from './workspaceDetailState';

const readyFacts = {
  hasWorkspaceId: true,
  isLoading: false,
  hasWorkspace: true,
  error: null,
};

test.describe('workspace detail state projection', () => {
  test('uses empty when no workspace is selected', () => {
    expect(
      deriveWorkspaceDetailState({
        ...readyFacts,
        hasWorkspaceId: false,
        hasWorkspace: false,
      })
    ).toBe('empty');
  });

  test('keeps first load distinct from an empty result', () => {
    expect(
      deriveWorkspaceDetailState({
        ...readyFacts,
        isLoading: true,
        hasWorkspace: false,
      })
    ).toBe('loading');
    expect(
      deriveWorkspaceDetailState({ ...readyFacts, hasWorkspace: false })
    ).toBe('empty');
  });

  test('returns a blocking error when no cached workspace exists', () => {
    expect(
      deriveWorkspaceDetailState({
        ...readyFacts,
        hasWorkspace: false,
        error: new Error('request failed'),
      })
    ).toBe('error');
  });

  test('preserves cached content as degraded on refresh failure', () => {
    expect(
      deriveWorkspaceDetailState({
        ...readyFacts,
        error: new Error('refresh failed'),
      })
    ).toBe('degraded');
  });

  test('returns ready after a successful load', () => {
    expect(deriveWorkspaceDetailState(readyFacts)).toBe('ready');
  });
});
