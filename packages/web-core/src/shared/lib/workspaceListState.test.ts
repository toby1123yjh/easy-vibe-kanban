import { expect, test } from '@playwright/test';
import { deriveWorkspaceListState } from './workspaceListState';

const readyFacts = {
  activeInitialized: true,
  archivedInitialized: true,
  activeConnected: true,
  archivedConnected: true,
  activeError: null,
  archivedError: null,
  summaryError: null,
  itemCount: 2,
};

test.describe('workspace list state projection', () => {
  test('keeps pending, successful empty, and first-load failure distinct', () => {
    expect(
      deriveWorkspaceListState({
        ...readyFacts,
        activeInitialized: false,
        archivedInitialized: false,
        itemCount: 0,
      })
    ).toBe('loading');
    expect(deriveWorkspaceListState({ ...readyFacts, itemCount: 0 })).toBe(
      'empty'
    );
    expect(
      deriveWorkspaceListState({
        ...readyFacts,
        activeInitialized: false,
        archivedInitialized: false,
        activeError: new Error('stream failed'),
        itemCount: 0,
      })
    ).toBe('error');
  });

  test('preserves a successful snapshot as degraded after disconnect', () => {
    expect(
      deriveWorkspaceListState({
        ...readyFacts,
        activeConnected: false,
        activeError: new Error('stream disconnected'),
      })
    ).toBe('degraded');
    expect(
      deriveWorkspaceListState({
        ...readyFacts,
        itemCount: 0,
        archivedConnected: false,
      })
    ).toBe('degraded');
  });

  test('treats summary failure as degraded only when summaries are relevant', () => {
    expect(
      deriveWorkspaceListState({
        ...readyFacts,
        summaryError: new Error('summary refresh failed'),
      })
    ).toBe('degraded');
    expect(
      deriveWorkspaceListState({
        ...readyFacts,
        itemCount: 0,
        summaryError: new Error('empty summaries failed'),
      })
    ).toBe('empty');
  });
});
