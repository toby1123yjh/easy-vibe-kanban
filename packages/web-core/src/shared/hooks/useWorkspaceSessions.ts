import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { sessionsApi } from '@/shared/lib/api';
import { useHostId } from '@/shared/providers/HostIdProvider';
import { workspaceSessionKeys } from '@/shared/hooks/workspaceSessionKeys';
import type { Session } from 'shared/types';
import {
  deriveSessionSelection,
  type SessionSelection,
} from './sessionSelection';

interface UseWorkspaceSessionsOptions {
  enabled?: boolean;
}

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
  const search = useSearch({ strict: false }) as {
    session_id?: string;
  };
  const requestedSessionId =
    typeof search.session_id === 'string' && search.session_id.length > 0
      ? search.session_id
      : getRequestedSessionId();
  const workspaceScopeKey = `${hostId ?? 'local'}:${workspaceId ?? 'missing'}`;
  const previousWorkspaceScopeRef = useRef(workspaceScopeKey);

  const sessionsQuery = useQuery<Session[]>({
    queryKey: workspaceSessionKeys.byWorkspace(workspaceId, hostId),
    queryFn: () => sessionsApi.getByWorkspace(workspaceId!),
    enabled: enabled && !!workspaceId,
  });
  const {
    data: sessions = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = sessionsQuery;

  // An empty result is only a valid initial-send state after discovery has
  // completed successfully. During loading or an error, keep the composer in
  // its placeholder state instead of implying that a session must be created.
  const hasResolvedEmptySessions =
    enabled &&
    !!workspaceId &&
    sessionsQuery.status === 'success' &&
    !isFetching &&
    !error &&
    sessions.length === 0;

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
    setSelection((prev) =>
      deriveSessionSelection({
        sessions,
        requestedSessionId,
        previous: prev,
        workspaceChanged,
        hasResolvedEmptySessions,
      })
    );
  }, [
    hasResolvedEmptySessions,
    requestedSessionId,
    sessions,
    workspaceScopeKey,
  ]);

  const isNewSessionMode =
    selection?.mode === 'new' || hasResolvedEmptySessions;
  // Effects run after paint. While the first selection effect is pending,
  // derive the same default synchronously so an existing workspace never
  // flashes the placeholder/new-session composer for one render.
  const implicitSelectedSessionId =
    selection?.mode === 'existing'
      ? selection.sessionId
      : selection?.mode === 'new'
        ? undefined
        : requestedSessionId &&
            sessions.some((session) => session.id === requestedSessionId)
          ? requestedSessionId
          : sessions[0]?.id;
  const selectedSessionId = implicitSelectedSessionId;

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
