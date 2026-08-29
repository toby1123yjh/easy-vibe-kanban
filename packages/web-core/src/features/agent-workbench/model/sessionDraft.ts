export interface SessionDraftState {
  readonly sessionId: string;
  readonly text: string;
  readonly revision: number;
}

export interface SessionDraftSubmission {
  readonly sessionId: string;
  readonly text: string;
  readonly revision: number;
}

export function createSessionDraft(
  sessionId: string,
  text = ''
): SessionDraftState {
  return { sessionId, text, revision: 0 };
}

export function updateSessionDraft(
  state: SessionDraftState,
  text: string
): SessionDraftState {
  return { ...state, text, revision: state.revision + 1 };
}

export function snapshotSessionDraft(
  state: SessionDraftState
): SessionDraftSubmission {
  return {
    sessionId: state.sessionId,
    text: state.text,
    revision: state.revision,
  };
}

export function isSessionDraftSubmissionCurrent(
  sessionId: string,
  text: string,
  revision: number,
  submission: SessionDraftSubmission
): boolean {
  return (
    submission.sessionId === sessionId &&
    submission.text === text &&
    submission.revision === revision
  );
}

export function acknowledgeSessionDraft(
  state: SessionDraftState,
  submission: SessionDraftSubmission
): SessionDraftState {
  if (
    state.sessionId !== submission.sessionId ||
    state.revision !== submission.revision
  ) {
    return state;
  }
  return updateSessionDraft(state, '');
}

export function restoreFailedSessionDraft(
  state: SessionDraftState,
  submission: SessionDraftSubmission
): SessionDraftState {
  if (state.sessionId !== submission.sessionId || state.text.length > 0) {
    return state;
  }
  return updateSessionDraft(state, submission.text);
}
