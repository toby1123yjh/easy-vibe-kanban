import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { VSCodeWorkspacePage } from '../../../../packages/web-core/src/pages/workspaces/VSCodeWorkspacePage';
import { AppNavigationProvider } from '../../../../packages/web-core/src/shared/hooks/useAppNavigation';
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '../../../../packages/web-core/src/shared/hooks/useWorkspaceContext';
import type { AppNavigation } from '../../../../packages/web-core/src/shared/lib/routes/appNavigation';
import '../../../../packages/web-core/src/i18n/config';
import '../../../../packages/ui/src/styles/tokens.css';
import './style.css';

type FixtureMode = 'loading' | 'empty' | 'error';

function readMode(): FixtureMode {
  const mode = new URLSearchParams(window.location.search).get('mode');
  return mode === 'loading' || mode === 'empty' ? mode : 'error';
}

const navigation: AppNavigation = {
  resolveFromPath: () => ({
    kind: 'workspace-vscode',
    workspaceId: 'workspace-fixture',
  }),
  goToRoot: () => undefined,
  goToOnboarding: () => undefined,
  goToOnboardingSignIn: () => undefined,
  goToWorkspaces: () => undefined,
  goToWorkspacesCreate: () => undefined,
  goToWorkspace: () => undefined,
  goToWorkspaceVsCode: () => undefined,
  goToExport: () => undefined,
  goToProject: () => undefined,
  goToProjectWorkflows: () => undefined,
  goToProjectWorkflowEdit: () => undefined,
  goToProjectWorkflowRun: () => undefined,
  goToProjectIssue: () => undefined,
  goToProjectIssueWorkspace: () => undefined,
  goToProjectIssueWorkspaceCreate: () => undefined,
  goToProjectWorkspaceCreate: () => undefined,
};

function Harness() {
  const [mode, setMode] = React.useState<FixtureMode>(readMode);
  const [retryCount, setRetryCount] = React.useState(0);

  const workspaceContext = React.useMemo<WorkspaceContextValue>(
    () => ({
      workspaceId: 'workspace-fixture',
      workspace: undefined,
      activeWorkspaces: [],
      archivedWorkspaces: [],
      workspaceListState: 'ready',
      isWorkspacesListLoading: false,
      isWorkspacesListRetrying: false,
      workspaceListError: null,
      retryWorkspaces: async () => undefined,
      isLoading: mode === 'loading',
      isWorkspaceLoading: mode === 'loading',
      workspaceError:
        mode === 'error' ? new Error('Fixture workspace read failed') : null,
      retryWorkspace: async () => {
        setRetryCount((count) => count + 1);
        setMode('empty');
      },
      isCreateMode: false,
      selectWorkspace: () => undefined,
      navigateToCreate: () => undefined,
      sessions: [],
      selectedSession: undefined,
      selectedSessionId: undefined,
      selectSession: () => undefined,
      selectLatestSession: () => undefined,
      isSessionsLoading: false,
      sessionsError: null,
      retrySessions: async () => undefined,
      isNewSessionMode: false,
      startNewSession: () => undefined,
      repos: [],
      isReposLoading: false,
      reposError: null,
      retryRepos: async () => undefined,
    }),
    [mode]
  );

  return (
    <AppNavigationProvider value={navigation}>
      <WorkspaceContext.Provider value={workspaceContext}>
        <VSCodeWorkspacePage />
        <span aria-hidden="true" data-testid="retry-count">
          {retryCount}
        </span>
      </WorkspaceContext.Provider>
    </AppNavigationProvider>
  );
}

const rootRoute = createRootRoute({ component: Harness });
const router = createRouter({
  routeTree: rootRoute,
  history: createMemoryHistory({ initialEntries: ['/workspace-fixture'] }),
});
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const root = document.getElementById('root');
if (!root) throw new Error('VS Code workspace fixture root is missing');
createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>
);
