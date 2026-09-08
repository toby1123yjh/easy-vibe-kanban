import { expect, test } from '@playwright/test';
import { deriveSessionSelection } from './sessionSelection';

const baseFacts = {
  requestedSessionId: null,
  workspaceChanged: false,
};

test.describe('workspace session selection', () => {
  test('waits for a successful empty result before entering new mode', () => {
    expect(
      deriveSessionSelection({
        ...baseFacts,
        sessions: [],
        previous: undefined,
        hasResolvedEmptySessions: false,
      })
    ).toBeUndefined();

    expect(
      deriveSessionSelection({
        ...baseFacts,
        sessions: [],
        previous: undefined,
        hasResolvedEmptySessions: true,
      })
    ).toEqual({ mode: 'new' });
  });

  test('keeps a new draft while the created row is published', () => {
    expect(
      deriveSessionSelection({
        ...baseFacts,
        sessions: [{ id: 'created-session' }],
        previous: { mode: 'new' },
        hasResolvedEmptySessions: false,
      })
    ).toEqual({ mode: 'new' });
  });

  test('keeps a new draft across a transient refresh', () => {
    expect(
      deriveSessionSelection({
        ...baseFacts,
        sessions: [],
        previous: { mode: 'new' },
        hasResolvedEmptySessions: false,
      })
    ).toEqual({ mode: 'new' });
  });

  test('honors a requested session and clears stale selection on scope change', () => {
    expect(
      deriveSessionSelection({
        ...baseFacts,
        sessions: [{ id: 'requested-session' }, { id: 'latest-session' }],
        requestedSessionId: 'requested-session',
        previous: undefined,
        hasResolvedEmptySessions: false,
      })
    ).toEqual({ mode: 'existing', sessionId: 'requested-session' });

    expect(
      deriveSessionSelection({
        ...baseFacts,
        sessions: [],
        workspaceChanged: true,
        previous: { mode: 'new' },
        hasResolvedEmptySessions: false,
      })
    ).toBeUndefined();
  });
});
