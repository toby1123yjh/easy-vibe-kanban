import { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
  useLocation,
} from '@tanstack/react-router';
import { useRenderedPathname } from '@/shared/hooks/useRenderedPathname';
import { useCurrentAppDestination } from '@/shared/hooks/useCurrentAppDestination';
import { AppNavigationProvider } from '@/shared/hooks/useAppNavigation';
import { derivePageCanvasMode } from '@/features/app-shell/model/appShell';
import type { AppNavigation } from '@/shared/lib/routes/appNavigation';

type Observation = {
  page: string;
  pathname: string;
  mode: string;
  missing: boolean;
};
declare global {
  interface Window {
    routeTest: {
      observations: Observation[];
      arm(): void;
      release(): void;
    };
  }
}
const observations: Observation[] = [];
let release: (() => void) | undefined;
let settingsGate: Promise<void> | undefined;

Object.assign(window, {
  routeTest: {
    observations,
    arm() {
      settingsGate = new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    release() {
      release?.();
      settingsGate = undefined;
    },
  },
});

// Only path resolution is used by these real hooks; no production API is called.
const noop = () => {};
const navigation: AppNavigation = {
  resolveFromPath(path: string) {
    const { foundRoute, routeParams } = router.getMatchedRoutes(path);
    return foundRoute?.id === project.id
      ? { kind: 'project', projectId: routeParams.projectId }
      : null;
  },
  goToRoot: noop,
  goToOnboarding: noop,
  goToOnboardingSignIn: noop,
  goToWorkspaces: noop,
  goToWorkspacesCreate: noop,
  goToWorkspace: noop,
  goToWorkspaceVsCode: noop,
  goToExport: noop,
  goToProject: noop,
  goToProjectWorkflows: noop,
  goToProjectWorkflowEdit: noop,
  goToProjectWorkflowRun: noop,
  goToProjectIssue: noop,
  goToProjectIssueWorkspace: noop,
  goToProjectIssueWorkspaceCreate: noop,
  goToProjectWorkspaceCreate: noop,
};

function Page({ name }: { name: string }) {
  const destination = useCurrentAppDestination();
  const pathname = useRenderedPathname();
  const missing = name === 'project' && destination?.kind !== 'project';
  useLayoutEffect(() => {
    observations.push({
      page: name,
      pathname,
      mode: derivePageCanvasMode(pathname),
      missing,
    });
  });
  return (
    <section data-testid="page" data-page={name}>
      {missing ? 'Project missing' : name}
    </section>
  );
}

function Shell() {
  const location = useLocation();
  const pathname = useRenderedPathname();
  return (
    <AppNavigationProvider value={navigation}>
      <nav>
        <Link to="/projects/$projectId" params={{ projectId: 'one' }}>
          Project
        </Link>{' '}
        <Link to="/settings">Settings</Link>{' '}
        <Link to="/dashboard">Dashboard</Link>
      </nav>
      <output data-testid="location">{location.pathname}</output>
      <output data-testid="rendered">{pathname}</output>
      <main data-testid="canvas" data-mode={derivePageCanvasMode(pathname)}>
        <Outlet />
      </main>
    </AppNavigationProvider>
  );
}

const root = createRootRoute({ component: Shell });
const project = createRoute({
  getParentRoute: () => root,
  path: '/projects/$projectId',
  component: () => <Page name="project" />,
});
const settings = createRoute({
  getParentRoute: () => root,
  path: '/settings',
  loader: () => settingsGate,
  component: () => <Page name="settings" />,
});
const dashboard = createRoute({
  getParentRoute: () => root,
  path: '/dashboard',
  component: () => <Page name="dashboard" />,
});
const router = createRouter({
  routeTree: root.addChildren([project, settings, dashboard]),
  defaultPendingMs: 60_000,
  defaultPreload: false,
});

createRoot(document.getElementById('root')!).render(
  <RouterProvider router={router} />
);
