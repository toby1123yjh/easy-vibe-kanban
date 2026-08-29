import { expect, test } from '@playwright/test';
import {
  acknowledgeSessionDraft,
  createSessionDraft,
  isSessionDraftSubmissionCurrent,
  restoreFailedSessionDraft,
  snapshotSessionDraft,
  updateSessionDraft,
} from './sessionDraft';

const describe = test.describe;
const it = test;

describe('session draft snapshots', () => {
  it('clears only the exact acknowledged snapshot', () => {
    const submitted = updateSessionDraft(createSessionDraft('session-1'), 'A');
    const snapshot = snapshotSessionDraft(submitted);
    expect(acknowledgeSessionDraft(submitted, snapshot).text).toBe('');

    const newer = updateSessionDraft(submitted, 'B');
    expect(acknowledgeSessionDraft(newer, snapshot).text).toBe('B');
  });

  it('restores a failed submission without replacing newer typing', () => {
    const submitted = updateSessionDraft(createSessionDraft('session-1'), 'A');
    const snapshot = snapshotSessionDraft(submitted);
    const empty = updateSessionDraft(submitted, '');
    expect(restoreFailedSessionDraft(empty, snapshot).text).toBe('A');

    const newer = updateSessionDraft(empty, 'B');
    expect(restoreFailedSessionDraft(newer, snapshot).text).toBe('B');
  });

  it('never applies a snapshot to a different session', () => {
    const snapshot = snapshotSessionDraft(
      updateSessionDraft(createSessionDraft('session-1'), 'A')
    );
    const other = createSessionDraft('session-2');
    expect(acknowledgeSessionDraft(other, snapshot)).toBe(other);
    expect(restoreFailedSessionDraft(other, snapshot)).toBe(other);
  });

  it('recognizes only the immutable session, text, and revision snapshot', () => {
    const snapshot = snapshotSessionDraft(
      updateSessionDraft(createSessionDraft('session-1'), 'A')
    );
    expect(isSessionDraftSubmissionCurrent('session-1', 'A', 1, snapshot)).toBe(
      true
    );
    expect(isSessionDraftSubmissionCurrent('session-1', 'B', 1, snapshot)).toBe(
      false
    );
    expect(isSessionDraftSubmissionCurrent('session-2', 'A', 1, snapshot)).toBe(
      false
    );
    expect(isSessionDraftSubmissionCurrent('session-1', 'A', 2, snapshot)).toBe(
      false
    );
  });
});
