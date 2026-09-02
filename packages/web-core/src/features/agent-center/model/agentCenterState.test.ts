import { expect, test } from '@playwright/test';
import {
  advanceAgentCenterScope,
  canPublishAgentCenterOperation,
  isAgentCenterScopeCurrent,
  projectAgentCenterSource,
} from './agentCenterState';

const baseFacts = {
  hasCanonicalData: false,
  isLoading: false,
  isFetching: false,
  error: null,
  diagnosticCount: 0,
  capabilityAvailable: true,
};

test.describe('Agent Center source projection', () => {
  test('keeps first load, initial error, and successful unavailable distinct', () => {
    expect(
      projectAgentCenterSource({
        ...baseFacts,
        isLoading: true,
        isFetching: true,
      }).state
    ).toBe('loading');
    expect(
      projectAgentCenterSource({
        ...baseFacts,
        error: new Error('offline'),
      }).state
    ).toBe('error');
    expect(projectAgentCenterSource(baseFacts).state).toBe('unavailable');
  });

  test('preserves cached data as degraded and fails closed for writes', () => {
    expect(
      projectAgentCenterSource({
        ...baseFacts,
        hasCanonicalData: true,
        error: new Error('refresh failed'),
      })
    ).toEqual({
      state: 'degraded',
      hasUsableData: true,
      isRefreshing: false,
      canMutate: false,
    });
    expect(
      projectAgentCenterSource({
        ...baseFacts,
        hasCanonicalData: true,
        diagnosticCount: 1,
      }).state
    ).toBe('degraded');
  });

  test('keeps usable content during an ordinary refresh', () => {
    expect(
      projectAgentCenterSource({
        ...baseFacts,
        hasCanonicalData: true,
        isFetching: true,
      })
    ).toEqual({
      state: 'ready',
      hasUsableData: true,
      isRefreshing: true,
      canMutate: true,
    });
  });

  test('does not turn a successful missing capability into fake counts', () => {
    expect(
      projectAgentCenterSource({
        ...baseFacts,
        hasCanonicalData: true,
        capabilityAvailable: false,
      })
    ).toEqual({
      state: 'unavailable',
      hasUsableData: true,
      isRefreshing: false,
      canMutate: false,
    });
  });
});

test.describe('Agent Center scope epochs', () => {
  test('rejects an old A completion after an A to B to A transition', () => {
    const firstA = { identity: 'A', epoch: 0 };
    const nextB = advanceAgentCenterScope(firstA, 'B');
    const nextA = advanceAgentCenterScope(nextB, 'A');

    expect(nextB).toEqual({ identity: 'B', epoch: 1 });
    expect(nextA).toEqual({ identity: 'A', epoch: 2 });
    expect(isAgentCenterScopeCurrent(firstA, nextA)).toBe(false);
    expect(isAgentCenterScopeCurrent(nextA, nextA)).toBe(true);
    expect(canPublishAgentCenterOperation(firstA, nextA, true)).toBe(false);
    expect(canPublishAgentCenterOperation(nextA, nextA, true)).toBe(true);
  });

  test('rejects completion after the owner unmounts', () => {
    const scope = { identity: 'A', epoch: 4 };

    expect(canPublishAgentCenterOperation(scope, scope, false)).toBe(false);
  });
});
