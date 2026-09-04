import { expect, test } from '@playwright/test';
import { deriveProjectDirectoryState } from './projectDirectoryState';

const readyFacts = {
  hasSource: true,
  isRemoteOffline: false,
  isLoading: false,
  isError: false,
  isFetchNextPageError: false,
  itemCount: 2,
  visibleItemCount: 2,
  isSearchHydrating: false,
};

test.describe('project directory state projection', () => {
  test('distinguishes unavailable, offline, loading, and initial error', () => {
    expect(
      deriveProjectDirectoryState({ ...readyFacts, hasSource: false })
    ).toBe('unavailable');
    expect(
      deriveProjectDirectoryState({ ...readyFacts, isRemoteOffline: true })
    ).toBe('offline');
    expect(
      deriveProjectDirectoryState({
        ...readyFacts,
        isLoading: true,
        itemCount: 0,
        visibleItemCount: 0,
      })
    ).toBe('loading');
    expect(
      deriveProjectDirectoryState({
        ...readyFacts,
        isError: true,
        itemCount: 0,
        visibleItemCount: 0,
      })
    ).toBe('error');
  });

  test('uses empty only after a successful zero-result projection', () => {
    expect(
      deriveProjectDirectoryState({
        ...readyFacts,
        itemCount: 0,
        visibleItemCount: 0,
      })
    ).toBe('empty');
    expect(
      deriveProjectDirectoryState({
        ...readyFacts,
        visibleItemCount: 0,
        isSearchHydrating: true,
      })
    ).toBe('ready');
  });

  test('preserves cached projects as degraded for either failed request', () => {
    expect(deriveProjectDirectoryState({ ...readyFacts, isError: true })).toBe(
      'degraded'
    );
    expect(
      deriveProjectDirectoryState({
        ...readyFacts,
        isFetchNextPageError: true,
      })
    ).toBe('degraded');
    expect(
      deriveProjectDirectoryState({
        ...readyFacts,
        isError: true,
        visibleItemCount: 0,
      })
    ).toBe('degraded');
  });

  test('returns ready when projects are available', () => {
    expect(deriveProjectDirectoryState(readyFacts)).toBe('ready');
  });
});
