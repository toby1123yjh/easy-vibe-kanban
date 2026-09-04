export type ProjectBoardAccessState =
  | 'loading'
  | 'permission'
  | 'error'
  | 'empty'
  | 'ready';

export interface ProjectBoardAccessStateFacts {
  authLoaded: boolean;
  isLoading: boolean;
  isSignedIn: boolean;
  hasResolutionError: boolean;
  hasProjectIdentity: boolean;
}

export function deriveProjectBoardAccessState({
  authLoaded,
  isLoading,
  isSignedIn,
  hasResolutionError,
  hasProjectIdentity,
}: ProjectBoardAccessStateFacts): ProjectBoardAccessState {
  if (!authLoaded || isLoading) return 'loading';
  if (!isSignedIn) return 'permission';
  if (hasResolutionError && !hasProjectIdentity) return 'error';
  if (!hasProjectIdentity) return 'empty';
  return 'ready';
}
