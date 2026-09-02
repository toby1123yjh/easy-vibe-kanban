import { useMemo } from 'react';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { AppShellContainer } from '@/features/app-shell/containers/AppShellContainer';
import type { AppShellCapabilityAdapter } from '@/features/app-shell/model/appShell';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { useAuth } from '@/shared/hooks/auth/useAuth';
import { useSettingsNavigation } from '@/shared/hooks/useSettingsNavigation';
import { useAppUpdateStore } from '@/shared/stores/useAppUpdateStore';
import { OAuthDialog } from '@/shared/dialogs/global/OAuthDialog';
import { SyncErrorProvider } from '@/shared/providers/SyncErrorProvider';

export function SharedAppLayout() {
  const navigate = useNavigate();
  const appNavigation = useAppNavigation();
  const { appVersion, environment } = useUserSystem();
  const { isSignedIn } = useAuth();
  const { openSettings } = useSettingsNavigation();
  const updateSnapshot = useAppUpdateStore((state) => state.snapshot);

  const adapter = useMemo<AppShellCapabilityAdapter>(
    () => ({
      deployment: 'local',
      environmentLabel: environment
        ? `Local · ${environment.os_type}`
        : 'Local environment',
      versionLabel: appVersion,
      updateNotice:
        updateSnapshot.phase === 'available' ||
        updateSnapshot.phase === 'restart-ready'
          ? {
              phase: updateSnapshot.phase,
              version: updateSnapshot.version,
              open: () => openSettings('application'),
            }
          : null,
      userLabel: isSignedIn ? 'Account' : 'Sign in',
      moduleCapabilities: {
        dashboard: {
          availability: 'available',
          navigate: () => void navigate({ to: '/dashboard' }),
        },
        projects: {
          availability: 'available',
          navigate: () => void navigate({ to: '/projects' }),
        },
        workflows: {
          availability: 'available',
          navigate: () => void navigate({ to: '/workflows' }),
        },
        agents: {
          availability: 'available',
          navigate: () => void navigate({ to: '/agents' }),
        },
      },
      navigateToRoute: (route) => {
        const projectMatch = route.match(/^\/projects\/([^/?]+)/);
        if (projectMatch) {
          appNavigation.goToProject(decodeURIComponent(projectMatch[1]));
          return;
        }
        const workspaceMatch = route.match(/^\/workspaces\/([^/?]+)/);
        if (workspaceMatch) {
          appNavigation.goToWorkspace(decodeURIComponent(workspaceMatch[1]));
          return;
        }
        if (route.startsWith('/settings')) {
          const target = new URL(route, window.location.origin);
          void navigate({
            to: '/settings',
            search: Object.fromEntries(target.searchParams),
          });
          return;
        }
        if (route.startsWith('/agents')) {
          void navigate({ to: '/agents' });
          return;
        }
        if (route === '/dashboard') void navigate({ to: '/dashboard' });
        else if (route === '/projects') void navigate({ to: '/projects' });
        else if (route === '/workflows') void navigate({ to: '/workflows' });
      },
      openSettings: () => openSettings(),
      openUser: () => {
        if (isSignedIn) openSettings('organizations');
        else void OAuthDialog.show({});
      },
    }),
    [
      appNavigation,
      appVersion,
      environment,
      isSignedIn,
      navigate,
      openSettings,
      updateSnapshot,
    ]
  );

  return (
    <SyncErrorProvider>
      <AppShellContainer adapter={adapter}>
        <Outlet />
      </AppShellContainer>
    </SyncErrorProvider>
  );
}
