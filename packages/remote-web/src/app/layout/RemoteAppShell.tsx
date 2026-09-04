import { useMemo, type ReactNode } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { AppShellContainer } from "@/features/app-shell/containers/AppShellContainer";
import {
  createAppShellDiscoveryScopeKey,
  type AppShellCapabilityAdapter,
} from "@/features/app-shell/model/appShell";
import { useAppNavigation } from "@/shared/hooks/useAppNavigation";
import { useUserSystem } from "@/shared/hooks/useUserSystem";
import { useAuth } from "@/shared/hooks/auth/useAuth";
import { useSettingsNavigation } from "@/shared/hooks/useSettingsNavigation";
import { CloudShutdownExportBanner } from "@/shared/components/CloudShutdownExportBanner";

interface RemoteAppShellProps {
  children: ReactNode;
  navigationHostId: string | null;
}

export function RemoteAppShell({
  children,
  navigationHostId,
}: RemoteAppShellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const appNavigation = useAppNavigation();
  const { appVersion, environment } = useUserSystem();
  const { isSignedIn, userId } = useAuth();
  const { openSettings } = useSettingsNavigation();
  const showCloudShutdownBanner =
    location.pathname === "/export" ||
    (isSignedIn && /^\/projects\/[^/]+/.test(location.pathname));

  const adapter = useMemo<AppShellCapabilityAdapter>(
    () => ({
      deployment: "remote",
      discoveryHostId: navigationHostId,
      discoveryScopeKey: createAppShellDiscoveryScopeKey({
        deployment: "remote",
        hostId: navigationHostId,
        userId,
      }),
      environmentLabel: environment
        ? `Remote host · ${environment.os_type}`
        : "Remote host",
      versionLabel: appVersion,
      userLabel: "Account",
      moduleCapabilities: {
        dashboard: {
          availability: "available",
          navigate: () => void navigate({ to: "/dashboard" }),
        },
        projects: {
          availability: "available",
          navigate: () => void navigate({ to: "/projects" }),
        },
        workflows: {
          availability: "available",
          navigate: () => void navigate({ to: "/workflows" }),
        },
        agents: {
          availability: "available",
          navigate: () => void navigate({ to: "/agents" }),
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
        if (route.startsWith("/settings")) {
          const target = new URL(route, window.location.origin);
          void navigate({
            to: "/settings",
            search: Object.fromEntries(target.searchParams),
          });
          return;
        }
        if (route.startsWith("/agents")) {
          void navigate({ to: "/agents" });
          return;
        }
        if (route === "/dashboard") void navigate({ to: "/dashboard" });
        else if (route === "/projects") void navigate({ to: "/projects" });
        else if (route === "/workflows") void navigate({ to: "/workflows" });
      },
      openSettings: () => openSettings(),
      openUser: () => void navigate({ to: "/account" }),
    }),
    [
      appNavigation,
      appVersion,
      environment,
      navigate,
      navigationHostId,
      openSettings,
      userId,
    ],
  );

  return (
    <AppShellContainer
      adapter={adapter}
      banner={
        showCloudShutdownBanner ? (
          <CloudShutdownExportBanner
            onClick={() => void navigate({ to: "/export" })}
          />
        ) : undefined
      }
    >
      {children}
    </AppShellContainer>
  );
}
