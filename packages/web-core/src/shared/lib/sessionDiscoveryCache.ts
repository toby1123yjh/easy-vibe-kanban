import type { QueryClient } from '@tanstack/react-query';

/** Refresh canonical session discovery without replacing its scoped API rows. */
export function invalidateSessionDiscovery(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: ['app-shell', 'discovery'],
    predicate: ({ queryKey }) => queryKey[3] === 'sessions',
  });
}
