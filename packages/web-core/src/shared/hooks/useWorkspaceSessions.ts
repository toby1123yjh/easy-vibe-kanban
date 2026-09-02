import { useQuery } from '@tanstack/react-query';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { sessionsApi } from '@/shared/lib/api';
import { useHostId } from '@/shared/providers/HostIdProvider';
import { workspaceSessionKeys } from '@/shared/hooks/workspaceSessionKeys';
import type { Session } from 'shared/types';

interface UseWorkspaceSessionsOptions {
  enabled?: boolean;
}

/** Discriminated union for session selection state */
export type SessionSelection =
  | { mode: 'existing'; sessionId: string }
  | { mode: 'new' };

function getRequestedSessionId(): string | null {
  if (typeof window === 'undefined') return null;

  return new URLSearchParams(window.location.search).get('session_id');
}

interface UseWorkspaceSessionsResult {
  sessions: Session[];
  selectedSession: Session | undefined;
  selectedSessionId: string | undefined;
  selectSession: (sessionId: string) => void;
  selectLatestSession: () => void;
  isLoading: boolean;
  error: unknown;
  retry: () => Promise<void>;
  /** Whether user is creating a new session */
  isNewSessionMode: boolean;
  /** Enter new session mode */
  startNewSession: () => void;
}

/**
 * Hook for managing sessions within a workspace.
 * Fetches all sessions for a workspace and provides session switching capability.
 * Sessions are ordered by most recently used (latest non-dev server execution first).
 */
export function useWorkspaceSessions(
  workspaceId: string | undefined,
  options: UseWorkspaceSessionsOptions = {}
): UseWorkspaceSessionsResult {
  const hostId = useHostId();
  const { enabled = true } = options;
  const [selection, setSelection] = useState<SessionSelection | undefined>(
    undefined
  );
  const workspaceScopeKey = `${hostId ?? 'local'}:${workspaceId ?? 'missing'}`;
  const previousWorkspaceScopeRef = useRef(workspaceScopeKey);

  const sessionsQuery = useQuery<Session[]>({
    queryKey: workspaceSessionKeys.byWorkspace(workspaceId, hostId),
    queryFn: () => sessionsApi.getByWorkspace(workspaceId!),
    enabled: enabled && !!workspaceId,
  });
  const { data: sessions = [], isLoading, error, refetch } = sessionsQuery;

  const retry = useCallback(async () => {
    await refetch();
  }, [refetch]);

  // Combined effect: handle workspace changes and auto-select sessions
  // This replaces two separate effects that had a race condition where the reset
  // effect would fire after auto-select when sessions were cached, undoing the selection.
  useEffect(() => {
    const workspaceChanged =
      previousWorkspaceScopeRef.current !== workspaceScopeKey;
    previousWorkspaceScopeRef.current = workspaceScopeKey;
    const requestedSessionId = getRequestedSessionId();

    if (sessions.length > 0) {
      // Workflow run links can request a specific session; otherwise sessions
      // are ordered by most recent use, so the first session is the default.
      // Only preserve new session mode within the same workspace.
      setSelection((prev) => {
        if (
          requestedSessionId &&
          sessions.some((session) => session.id === requestedSessionId)
        ) {
          return { mode: 'existing', sessionId: requestedSessionId };
        }
        if (prev?.mode === 'new' && !workspaceChanged) return prev;
        return { mode: 'existing', sessionId: sessions[0].id };
      });
    } else {
      setSelection(undefined);
    }
  }, [sessions, workspaceScopeKey]);

  const isNewSessionMode = selection?.mode === 'new' || sessions.length === 0;
  const selectedSessionId =
    selection?.mode === 'existing' ? selection.sessionId : undefined;

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId),
    [sessions, selectedSessionId]
  );

  const selectSession = useCallback((sessionId: string) => {
    setSelection({ mode: 'existing', sessionId });
  }, []);

  const selectLatestSession = useCallback(() => {
    if (sessions.length > 0) {
      setSelection({ mode: 'existing', sessionId: sessions[0].id });
    }
  }, [sessions]);

  const startNewSession = useCallback(() => {
    setSelection({ mode: 'new' });
  }, []);

  return {
    sessions,
    selectedSession,
    selectedSessionId,
    selectSession,
    selectLatestSession,
    isLoading,
    error,
    retry,
    isNewSessionMode,
    startNewSession,
  };
}
