import { expect, test } from '@playwright/test';
import { deriveAuthMethodDiscoveryState } from './authMethodDiscoveryState';

const readyFacts = {
  isLoading: false,
  hasData: true,
  hasError: false,
  hasLocalAuth: true,
  oauthProviderCount: 1,
};

test.describe('authentication method discovery state', () => {
  test('keeps first load and initial failure distinct', () => {
    expect(
      deriveAuthMethodDiscoveryState({
        ...readyFacts,
        isLoading: true,
        hasData: false,
      })
    ).toBe('loading');
    expect(
      deriveAuthMethodDiscoveryState({
        ...readyFacts,
        hasData: false,
        hasError: true,
      })
    ).toBe('error');
  });

  test('preserves cached authentication methods after refresh failure', () => {
    expect(
      deriveAuthMethodDiscoveryState({ ...readyFacts, hasError: true })
    ).toBe('degraded');
  });

  test('uses empty only for a successful zero-method response', () => {
    expect(
      deriveAuthMethodDiscoveryState({
        ...readyFacts,
        hasLocalAuth: false,
        oauthProviderCount: 0,
      })
    ).toBe('empty');
  });

  test('accepts either local or OAuth authentication as ready', () => {
    expect(
      deriveAuthMethodDiscoveryState({
        ...readyFacts,
        oauthProviderCount: 0,
      })
    ).toBe('ready');
    expect(
      deriveAuthMethodDiscoveryState({
        ...readyFacts,
        hasLocalAuth: false,
      })
    ).toBe('ready');
  });
});
