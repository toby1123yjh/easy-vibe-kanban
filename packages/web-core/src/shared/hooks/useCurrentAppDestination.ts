import { useMemo } from 'react';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useRenderedPathname } from '@/shared/hooks/useRenderedPathname';
import type { AppDestination } from '@/shared/lib/routes/appNavigation';

export function useCurrentAppDestination(): AppDestination | null {
  const appNavigation = useAppNavigation();
  const pathname = useRenderedPathname();

  return useMemo(
    () => appNavigation.resolveFromPath(pathname),
    [appNavigation, pathname]
  );
}
