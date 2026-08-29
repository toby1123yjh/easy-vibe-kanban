import * as React from 'react';
import { createRoot } from 'react-dom/client';
import type { ProjectListItem, SessionListItem } from 'shared/types';
import { deriveActiveShellModule } from '../../../../packages/web-core/src/features/app-shell/model/appShell';
import type { AppShellCapabilityAdapter } from '../../../../packages/web-core/src/features/app-shell/model/appShell';
import { GlobalSearchPalette } from '../../../../packages/web-core/src/features/app-shell/ui/GlobalSearchPalette';
import { PageCanvas } from '../../../../packages/web-core/src/features/app-shell/ui/PageCanvas';
import { ProductSidebar } from '../../../../packages/web-core/src/features/app-shell/ui/ProductSidebar';
import type { SidebarSectionState } from '../../../../packages/web-core/src/features/app-shell/ui/ProductSidebar';
import '../../../../packages/ui/src/styles/tokens.css';
import '../../../../packages/web-core/src/features/app-shell/ui/app-shell.css';
import './style.css';

const PROJECTS: ProjectListItem[] = Array.from({ length: 24 }, (_, index) => ({
  id: `project-${index + 1}`,
  name: `Project ${String(index + 1).padStart(2, '0')}`,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: `2026-08-${String(28 - index).padStart(2, '0')}T00:00:00Z`,
}));

const SESSIONS: SessionListItem[] = Array.from({ length: 16 }, (_, index) => ({
  id: `session-${index + 1}`,
  workspace_id: `workspace-${index + 1}`,
  task_id: `task-${index + 1}`,
  project_id: `project-${(index % 4) + 1}`,
  issue_id: `issue-${index + 1}`,
  title: `Session ${String(index + 1).padStart(2, '0')}`,
  executor: index % 2 === 0 ? 'Codex' : 'Claude Code',
  created_at: '2026-08-01T00:00:00Z',
  updated_at: `2026-08-${String(28 - index).padStart(2, '0')}T01:00:00Z`,
}));

function updateTheme(theme: 'light' | 'dark') {
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function AppShellHarness() {
  const [route, setRoute] = React.useState('/dashboard');
  const [activeProjectId, setActiveProjectId] = React.useState<string | null>(
    null
  );
  const [activeWorkspaceId, setActiveWorkspaceId] = React.useState<
    string | null
  >(null);
  const [objectDrawerOpen, setObjectDrawerOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [canvasMode, setCanvasMode] = React.useState<
    'contained' | 'full-bleed'
  >('contained');
  const [projects, setProjects] = React.useState(PROJECTS);
  const [projectHasNextPage, setProjectHasNextPage] = React.useState(false);
  const [projectPageLoads, setProjectPageLoads] = React.useState(0);
  const [systemAction, setSystemAction] = React.useState('none');
  const searchTriggerRef = React.useRef<HTMLElement | null>(null);
  const pageCanvasRef = React.useRef<HTMLElement>(null);
  const projectPageRequestedRef = React.useRef(false);

  const navigate = React.useCallback((nextRoute: string) => {
    setRoute(nextRoute);
    window.history.pushState({ fixture: 'app-shell' }, '', nextRoute);
    requestAnimationFrame(() => {
      pageCanvasRef.current?.focus({ preventScroll: true });
    });
  }, []);

  React.useEffect(() => {
    window.history.replaceState(
      { fixture: 'app-shell' },
      '',
      '/dashboard?fixture=app-shell'
    );
    updateTheme('light');
  }, []);

  const adapter = React.useMemo<AppShellCapabilityAdapter>(
    () => ({
      deployment: 'local',
      environmentLabel: 'Fixture / Local',
      versionLabel: '0.1.0-contract',
      userLabel: 'Fixture User',
      moduleCapabilities: {
        dashboard: {
          availability: 'available',
          navigate: () => navigate('/dashboard'),
        },
        projects: {
          availability: 'available',
          navigate: () => navigate('/projects'),
        },
        workflows: {
          availability: 'unavailable',
          reason: 'Workflow service is unavailable in this environment.',
        },
        agents: {
          availability: 'available',
          navigate: () => navigate('/agents'),
        },
      },
      navigateToRoute: navigate,
      openSettings: () => {
        setSystemAction('settings');
        navigate('/settings');
      },
      openUser: () => setSystemAction('user'),
    }),
    [navigate]
  );

  const requestProjectPage = React.useCallback(() => {
    if (projectPageRequestedRef.current) return;
    projectPageRequestedRef.current = true;
    setProjectPageLoads((count) => count + 1);
    setProjects((items) => [
      ...items,
      {
        id: 'project-loaded',
        name: 'Project loaded automatically',
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-07-01T00:00:00Z',
      },
    ]);
    setProjectHasNextPage(false);
  }, []);

  const enableProjectPaging = () => {
    projectPageRequestedRef.current = false;
    setProjectHasNextPage(true);
  };

  const projectState: SidebarSectionState<ProjectListItem> = {
    items: projects,
    isLoading: false,
    isError: false,
    hasNextPage: projectHasNextPage,
    isFetchingNextPage: false,
    retry: () => undefined,
    loadNextPage: requestProjectPage,
  };
  const sessionState: SidebarSectionState<SessionListItem> = {
    items: SESSIONS,
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    retry: () => undefined,
    loadNextPage: () => undefined,
  };
  const searchSources = React.useMemo(
    () => [
      {
        id: 'projects' as const,
        label: 'Project',
        state: 'available' as const,
        retry: () => undefined,
      },
      {
        id: 'sessions' as const,
        label: 'Session',
        state: 'available' as const,
        retry: () => undefined,
      },
    ],
    []
  );

  const openSearch = () => {
    searchTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setObjectDrawerOpen(false);
    setSearchOpen(true);
  };
  const closeSearch = (options?: { restoreFocus?: boolean }) => {
    setSearchOpen(false);
    if (options?.restoreFocus === false) return;
    requestAnimationFrame(() => {
      searchTriggerRef.current?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="vk-app-shell" data-testid="app-shell">
      <div className="vk-app-shell__layout" data-search-open={searchOpen}>
        <ProductSidebar
          adapter={adapter}
          activeModule={deriveActiveShellModule(route.split('?')[0])}
          activeProjectId={activeProjectId}
          activeWorkspaceId={activeWorkspaceId}
          projects={projectState}
          sessions={sessionState}
          objectDrawerOpen={objectDrawerOpen}
          onObjectDrawerOpenChange={setObjectDrawerOpen}
          onSearch={openSearch}
          onProject={(projectId) => {
            setActiveProjectId(projectId);
            navigate(`/projects/${projectId}`);
          }}
          onSession={(workspaceId) => {
            setActiveWorkspaceId(workspaceId);
            navigate(`/workspaces/${workspaceId}`);
          }}
        />
        <div className="vk-page-stack">
          <PageCanvas ref={pageCanvasRef} mode={canvasMode}>
            <section className="fixture-page">
              <h1>App Shell browser contract</h1>
              <p>
                Deterministic fixture using the production shell components.
              </p>
              <div className="fixture-page__actions">
                <button type="button" onClick={enableProjectPaging}>
                  Enable automatic project page
                </button>
                <button
                  type="button"
                  onClick={() => setCanvasMode('contained')}
                >
                  Contained canvas
                </button>
                <button
                  type="button"
                  onClick={() => setCanvasMode('full-bleed')}
                >
                  Full-bleed canvas
                </button>
                <button type="button" onClick={() => updateTheme('light')}>
                  Light theme
                </button>
                <button type="button" onClick={() => updateTheme('dark')}>
                  Dark theme
                </button>
              </div>
              <dl className="fixture-outputs">
                <div>
                  <dt>Route</dt>
                  <dd data-testid="current-route">{route}</dd>
                </div>
                <div>
                  <dt>Automatic project page loads</dt>
                  <dd data-testid="project-page-loads">{projectPageLoads}</dd>
                </div>
                <div>
                  <dt>System action</dt>
                  <dd data-testid="system-action">{systemAction}</dd>
                </div>
                <div>
                  <dt>Canvas mode</dt>
                  <dd data-testid="canvas-mode">{canvasMode}</dd>
                </div>
              </dl>
              <div className="fixture-wide-content" />
            </section>
          </PageCanvas>
        </div>
      </div>
      <GlobalSearchPalette
        open={searchOpen}
        projects={projects}
        sessions={SESSIONS}
        sources={searchSources}
        onClose={closeSearch}
        onNavigate={navigate}
      />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('App Shell fixture root is missing');
createRoot(root).render(<AppShellHarness />);
