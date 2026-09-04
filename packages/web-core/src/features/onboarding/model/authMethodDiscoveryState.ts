export type AuthMethodDiscoveryState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'ready'
  | 'degraded';

export interface AuthMethodDiscoveryStateFacts {
  isLoading: boolean;
  hasData: boolean;
  hasError: boolean;
  hasLocalAuth: boolean;
  oauthProviderCount: number;
}

export function deriveAuthMethodDiscoveryState({
  isLoading,
  hasData,
  hasError,
  hasLocalAuth,
  oauthProviderCount,
}: AuthMethodDiscoveryStateFacts): AuthMethodDiscoveryState {
  if (isLoading && !hasData) return 'loading';
  if (hasError && !hasData) return 'error';
  if (hasError) return 'degraded';
  if (!hasLocalAuth && oauthProviderCount === 0) return 'empty';
  return 'ready';
}
