export type WorkspaceListState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'ready'
  | 'degraded';

export interface WorkspaceListStateFacts {
  activeInitialized: boolean;
  archivedInitialized: boolean;
  activeConnected: boolean;
  archivedConnected: boolean;
  activeError: unknown;
  archivedError: unknown;
  summaryError: unknown;
  itemCount: number;
}

export function deriveWorkspaceListState({
  activeInitialized,
  archivedInitialized,
  activeConnected,
  archivedConnected,
  activeError,
  archivedError,
  summaryError,
  itemCount,
}: WorkspaceListStateFacts): WorkspaceListState {
  const hasSnapshot = activeInitialized && archivedInitialized;
  const streamError = activeError ?? archivedError;

  if (!hasSnapshot) return streamError ? 'error' : 'loading';

  if (
    streamError ||
    !activeConnected ||
    !archivedConnected ||
    (itemCount > 0 && summaryError)
  ) {
    return 'degraded';
  }

  return itemCount === 0 ? 'empty' : 'ready';
}
