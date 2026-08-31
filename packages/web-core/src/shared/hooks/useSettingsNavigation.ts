import { useCallback } from 'react';
import { useLocation, useNavigate, useParams } from '@tanstack/react-router';
import {
  getSettingsNavigationTarget,
  type SettingsNavigationSection,
} from '@/shared/lib/routes/appNavigation';

interface SettingsNavigationOptions {
  hostId?: string | null;
  replace?: boolean;
}

export function useSettingsNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const { hostId: routeHostId } = useParams({ strict: false });
  const settingsHostId =
    location.pathname === '/settings' &&
    typeof location.search.host === 'string'
      ? location.search.host
      : null;

  const openSettings = useCallback(
    (
      section: SettingsNavigationSection = 'application',
      options?: SettingsNavigationOptions
    ) => {
      const hostId = options?.hostId ?? settingsHostId ?? routeHostId ?? null;
      void navigate({
        to: '/settings',
        search: getSettingsNavigationTarget(section, hostId),
        replace: options?.replace,
      });
    },
    [navigate, routeHostId, settingsHostId]
  );

  const openAgentCenter = useCallback(() => {
    void navigate({ to: '/agents' });
  }, [navigate]);

  return { openAgentCenter, openSettings };
}
