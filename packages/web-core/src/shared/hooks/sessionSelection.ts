import type { Session } from 'shared/types';

export type SessionSelection =
  | { mode: 'existing'; sessionId: string }
  | { mode: 'new' };

interface SessionSelectionFacts {
  sessions: readonly Pick<Session, 'id'>[];
  requestedSessionId: string | null;
  previous: SessionSelection | undefined;
  workspaceChanged: boolean;
  hasResolvedEmptySessions: boolean;
}

/**
 * Resolves the workspace session selection without conflating an empty cache
 * with a successfully discovered empty workspace.
 */
export function deriveSessionSelection({
  sessions,
  requestedSessionId,
  previous,
  workspaceChanged,
  hasResolvedEmptySessions,
}: SessionSelectionFacts): SessionSelection | undefined {
  if (sessions.length > 0) {
    if (
      requestedSessionId &&
      sessions.some((session) => session.id === requestedSessionId)
    ) {
      return { mode: 'existing', sessionId: requestedSessionId };
    }
    // A create mutation publishes its row before the first follow-up
    // completes. Keep the composer in new-session mode until that follow-up
    // succeeds and explicitly selects the durable session.
    if (previous?.mode === 'new' && !workspaceChanged) return previous;
    return { mode: 'existing', sessionId: sessions[0].id };
  }

  if (hasResolvedEmptySessions) {
    return previous?.mode === 'new' && !workspaceChanged
      ? previous
      : { mode: 'new' };
  }

  // Preserve an explicit new-session draft while a background refresh is in
  // flight (or the same workspace reports a transient error). A workspace
  // change still clears the old selection.
  return previous?.mode === 'new' && !workspaceChanged ? previous : undefined;
}
