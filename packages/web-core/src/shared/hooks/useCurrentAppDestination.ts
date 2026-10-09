import { useMemo } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useRenderedPathname } from '@/shared/hooks/useRenderedPathname';
import type { AppDestination } from '@/shared/lib/routes/appNavigation';

export function useCurrentAppDestination(): AppDestination | null {
  const appNavigation = useAppNavigation();
  const pathname = useRenderedPathname();
  const hostId = useRouterState({
    select: (state) => {
      const search = state.matches.at(-1)?.search as
        | Record<string, unknown>
        | undefined;
      return typeof search?.host_id === 'string' ? search.host_id : null;
    },
  });

  return useMemo(
    () =>
      appNavigation.resolveFromPath(
        hostId ? `${pathname}?host_id=${encodeURIComponent(hostId)}` : pathname
      ),
    [appNavigation, pathname, hostId]
  );
}
