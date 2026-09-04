export type ProjectDirectoryState =
  | 'unavailable'
  | 'offline'
  | 'loading'
  | 'empty'
  | 'error'
  | 'ready'
  | 'degraded';

export interface ProjectDirectoryStateFacts {
  hasSource: boolean;
  isRemoteOffline: boolean;
  isLoading: boolean;
  isError: boolean;
  isFetchNextPageError: boolean;
  itemCount: number;
  visibleItemCount: number;
  isSearchHydrating: boolean;
}

export function deriveProjectDirectoryState({
  hasSource,
  isRemoteOffline,
  isLoading,
  isError,
  isFetchNextPageError,
  itemCount,
  visibleItemCount,
  isSearchHydrating,
}: ProjectDirectoryStateFacts): ProjectDirectoryState {
  if (!hasSource) return 'unavailable';
  if (isRemoteOffline) return 'offline';
  if (isLoading && itemCount === 0) return 'loading';

  const hasError = isError || isFetchNextPageError;
  if (hasError && itemCount === 0) return 'error';
  if (hasError) return 'degraded';
  if (visibleItemCount === 0 && !isSearchHydrating) return 'empty';
  return 'ready';
}
