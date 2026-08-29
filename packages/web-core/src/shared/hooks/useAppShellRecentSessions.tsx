import { useContext, type ReactNode } from 'react';
import type { SessionListItem } from 'shared/types';

import { createHmrContext } from '@/shared/lib/hmrContext';

const EMPTY_RECENT_SESSIONS: readonly SessionListItem[] = [];

const AppShellRecentSessionsContext = createHmrContext<
  readonly SessionListItem[] | null
>('AppShellRecentSessionsContext', null);

export function AppShellRecentSessionsProvider({
  sessions,
  children,
}: {
  sessions: readonly SessionListItem[];
  children: ReactNode;
}) {
  return (
    <AppShellRecentSessionsContext.Provider value={sessions}>
      {children}
    </AppShellRecentSessionsContext.Provider>
  );
}

export function useAppShellRecentSessions(): readonly SessionListItem[] {
  return useContext(AppShellRecentSessionsContext) ?? EMPTY_RECENT_SESSIONS;
}

export function findAppShellRecentSession(
  sessions: readonly SessionListItem[],
  sessionId: string | undefined
): SessionListItem | undefined {
  if (!sessionId) return undefined;
  return sessions.find((session) => session.id === sessionId);
}
