import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocation } from '@tanstack/react-router';
import type {
  ProjectCursor,
  ProjectListItem,
  SessionCursor,
  SessionListItem,
} from 'shared/types';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useCurrentAppDestination } from '@/shared/hooks/useCurrentAppDestination';
import { executionDataApi } from '@/shared/lib/executionDataApi';
import { getProjectDestination } from '@/shared/lib/routes/appNavigation';
import { useIsMobile } from '@/shared/hooks/useIsMobile';
import { useVisualViewportHeightVar } from '@/shared/hooks/useVisualViewportHeightVar';
import { useUiPreferencesStore } from '@/shared/stores/useUiPreferencesStore';
import {
  deriveActiveShellModule,
  derivePageCanvasMode,
  mergeStableCursorItems,
  type AppShellCapabilityAdapter,
} from '../model/appShell';
import { deriveSearchSourceState } from '../model/search';
import { GlobalSearchPalette } from '../ui/GlobalSearchPalette';
import { PageCanvas } from '../ui/PageCanvas';
import { ProductSidebar } from '../ui/ProductSidebar';
import '../ui/app-shell.css';

interface AppShellContainerProps {
  adapter: AppShellCapabilityAdapter;
  banner?: ReactNode;
  children: ReactNode;
}

export function AppShellContainer({
  adapter,
  banner,
  children,
}: AppShellContainerProps) {
  const location = useLocation();
  const appNavigation = useAppNavigation();
  const currentDestination = useCurrentAppDestination();
  const isMobile = useIsMobile();
  useVisualViewportHeightVar(isMobile);
  const mobileFontScale = useUiPreferencesStore(
    (state) => state.mobileFontScale
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [objectDrawerOpen, setObjectDrawerOpen] = useState(false);
  const searchTriggerRef = useRef<HTMLElement | null>(null);
  const mainContentRef = useRef<HTMLElement>(null);
  const previousLocationRef = useRef(location.href);

  useEffect(() => {
    if (!isMobile) {
      document.documentElement.style.removeProperty('--mobile-font-scale');
      return;
    }
    const scale = { default: '1', small: '0.9', smaller: '0.8' } as const;
    document.documentElement.style.setProperty(
      '--mobile-font-scale',
      scale[mobileFontScale]
    );
    return () => {
      document.documentElement.style.removeProperty('--mobile-font-scale');
    };
  }, [isMobile, mobileFontScale]);

  const projectsQuery = useInfiniteQuery({
    queryKey: ['app-shell', 'projects'],
    queryFn: ({ pageParam }) =>
      executionDataApi.listProjects({ cursor: pageParam, limit: 50 }),
    initialPageParam: null as ProjectCursor | null,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    staleTime: 30_000,
  });

  const sessionsQuery = useInfiniteQuery({
    queryKey: ['app-shell', 'sessions'],
    queryFn: ({ pageParam }) =>
      executionDataApi.listRecentSessions({ cursor: pageParam, limit: 50 }),
    initialPageParam: null as SessionCursor | null,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    staleTime: 15_000,
  });

  const projects = useMemo(
    () =>
      (projectsQuery.data?.pages ?? []).reduce(
        (items, page) => mergeStableCursorItems(items, page.projects),
        [] as ProjectListItem[]
      ),
    [projectsQuery.data?.pages]
  );
  const sessions = useMemo(
    () =>
      (sessionsQuery.data?.pages ?? []).reduce(
        (items, page) => mergeStableCursorItems(items, page.sessions),
        [] as SessionListItem[]
      ),
    [sessionsQuery.data?.pages]
  );
  const refetchProjects = projectsQuery.refetch;
  const refetchSessions = sessionsQuery.refetch;

  const activeProjectId =
    getProjectDestination(currentDestination)?.projectId ?? null;
  const activeWorkspaceId =
    currentDestination && 'workspaceId' in currentDestination
      ? currentDestination.workspaceId
      : null;
  const openSearch = useCallback(() => {
    searchTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setObjectDrawerOpen(false);
    setSearchOpen(true);
  }, []);

  const closeSearch = useCallback((options?: { restoreFocus?: boolean }) => {
    setSearchOpen(false);
    if (options?.restoreFocus === false) return;
    requestAnimationFrame(() => {
      if (searchTriggerRef.current?.isConnected) {
        searchTriggerRef.current.focus({ preventScroll: true });
      }
    });
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        event.stopPropagation();
        if (!searchOpen) openSearch();
      }
    };
    window.addEventListener('keydown', handleShortcut, { capture: true });
    return () =>
      window.removeEventListener('keydown', handleShortcut, { capture: true });
  }, [openSearch, searchOpen]);

  useEffect(() => setObjectDrawerOpen(false), [location.pathname]);

  useEffect(() => {
    if (previousLocationRef.current === location.href) return;
    previousLocationRef.current = location.href;
    const frame = requestAnimationFrame(() => {
      mainContentRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.href]);

  const projectState = {
    items: projects,
    isLoading: projectsQuery.isLoading,
    isError: projectsQuery.isError,
    hasNextPage: projectsQuery.hasNextPage,
    isFetchingNextPage: projectsQuery.isFetchingNextPage,
    retry: () => void projectsQuery.refetch(),
    loadNextPage: () => void projectsQuery.fetchNextPage(),
  };
  const sessionState = {
    items: sessions,
    isLoading: sessionsQuery.isLoading,
    isError: sessionsQuery.isError,
    hasNextPage: sessionsQuery.hasNextPage,
    isFetchingNextPage: sessionsQuery.isFetchingNextPage,
    retry: () => void sessionsQuery.refetch(),
    loadNextPage: () => void sessionsQuery.fetchNextPage(),
  };
  const searchSources = useMemo(
    () => [
      {
        id: 'projects' as const,
        label: 'Project',
        state: deriveSearchSourceState(projectsQuery.isError, projects.length),
        retry: (): void => {
          void refetchProjects();
        },
      },
      {
        id: 'sessions' as const,
        label: 'Session',
        state: deriveSearchSourceState(sessionsQuery.isError, sessions.length),
        retry: (): void => {
          void refetchSessions();
        },
      },
    ],
    [
      projects.length,
      projectsQuery.isError,
      refetchProjects,
      refetchSessions,
      sessions.length,
      sessionsQuery.isError,
    ]
  );

  return (
    <div
      className="vk-app-shell"
      style={isMobile ? { height: 'var(--app-vh, 100dvh)' } : undefined}
      data-deployment={adapter.deployment}
    >
      <a className="vk-skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="vk-app-shell__layout" data-search-open={searchOpen}>
        <ProductSidebar
          adapter={adapter}
          activeModule={deriveActiveShellModule(location.pathname)}
          activeProjectId={activeProjectId}
          activeWorkspaceId={activeWorkspaceId}
          projects={projectState}
          sessions={sessionState}
          objectDrawerOpen={objectDrawerOpen}
          onObjectDrawerOpenChange={setObjectDrawerOpen}
          onSearch={openSearch}
          onProject={(projectId) => appNavigation.goToProject(projectId)}
          onSession={(workspaceId) => appNavigation.goToWorkspace(workspaceId)}
        />
        <div className="vk-page-stack">
          {banner}
          <PageCanvas
            ref={mainContentRef}
            mode={derivePageCanvasMode(location.pathname)}
          >
            {children}
          </PageCanvas>
        </div>
      </div>
      <GlobalSearchPalette
        open={searchOpen}
        projects={projects}
        sessions={sessions}
        sources={searchSources}
        onClose={closeSearch}
        onNavigate={adapter.navigateToRoute}
      />
    </div>
  );
}
