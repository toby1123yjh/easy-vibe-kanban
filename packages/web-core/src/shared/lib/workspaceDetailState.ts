export type WorkspaceDetailState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'ready'
  | 'degraded';

export interface WorkspaceDetailStateFacts {
  hasWorkspaceId: boolean;
  isLoading: boolean;
  hasWorkspace: boolean;
  error: unknown;
}

/**
 * Projects the selected workspace query into the page state vocabulary.
 * React Query can retain a cached workspace while a refresh fails; that is a
 * degraded view, while an error without cached data is a blocking error.
 */
export function deriveWorkspaceDetailState({
  hasWorkspaceId,
  isLoading,
  hasWorkspace,
  error,
}: WorkspaceDetailStateFacts): WorkspaceDetailState {
  if (!hasWorkspaceId) return 'empty';
  if (isLoading && !hasWorkspace) return 'loading';
  if (error != null) return hasWorkspace ? 'degraded' : 'error';
  if (!hasWorkspace) return 'empty';
  return 'ready';
}
