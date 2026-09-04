import { expect, test } from '@playwright/test';
import { deriveProjectBoardAccessState } from './projectBoardAccessState';

const readyFacts = {
  authLoaded: true,
  isLoading: false,
  isSignedIn: true,
  hasResolutionError: false,
  hasProjectIdentity: true,
};

test.describe('project board access state projection', () => {
  test('keeps auth and project resolution loading explicit', () => {
    expect(
      deriveProjectBoardAccessState({ ...readyFacts, authLoaded: false })
    ).toBe('loading');
    expect(
      deriveProjectBoardAccessState({ ...readyFacts, isLoading: true })
    ).toBe('loading');
  });

  test('projects signed-out access as permission instead of empty', () => {
    expect(
      deriveProjectBoardAccessState({ ...readyFacts, isSignedIn: false })
    ).toBe('permission');
  });

  test('distinguishes a failed resolution from a successful miss', () => {
    expect(
      deriveProjectBoardAccessState({
        ...readyFacts,
        hasResolutionError: true,
        hasProjectIdentity: false,
      })
    ).toBe('error');
    expect(
      deriveProjectBoardAccessState({
        ...readyFacts,
        hasProjectIdentity: false,
      })
    ).toBe('empty');
  });

  test('returns ready only with a resolved project identity', () => {
    expect(deriveProjectBoardAccessState(readyFacts)).toBe('ready');
  });
});
