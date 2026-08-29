import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  FolderKanban,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
} from 'lucide-react';
import type { ProjectCursor, ProjectListItem } from 'shared/types';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useUserOrganizations } from '@/shared/hooks/useUserOrganizations';
import { executionDataApi } from '@/shared/lib/executionDataApi';
import { CreateRemoteProjectDialog } from '@/shared/dialogs/org/CreateRemoteProjectDialog';
import { SettingsDialog } from '@/shared/dialogs/settings/SettingsDialog';
import { mergeStableCursorItems } from '@/features/app-shell/model/appShell';
import { useOrganizationStore } from '@/shared/stores/useOrganizationStore';
import './project-surfaces.css';

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(new Date(value));
}

function ProjectCard({
  project,
  onOpen,
  onManage,
}: {
  project: ProjectListItem;
  onOpen(): void;
  onManage(): void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  return (
    <article className="vk-project-card">
      <button
        type="button"
        className="vk-project-card__open"
        onClick={onOpen}
        aria-label={`Open ${project.name}`}
      >
        <span className="vk-project-card__cover" aria-hidden="true">
          <FolderKanban size={28} />
        </span>
        <span className="vk-project-card__copy">
          <strong>{project.name}</strong>
          <small>Updated {formatUpdatedAt(project.updated_at)}</small>
        </span>
      </button>
      <button
        ref={triggerRef}
        type="button"
        className="vk-project-card__menu-trigger"
        aria-label={`More actions for ${project.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <MoreHorizontal aria-hidden="true" size={17} />
      </button>
      {menuOpen ? (
        <div ref={menuRef} className="vk-project-card__menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenuOpen(false);
              onManage();
            }}
          >
            <Settings aria-hidden="true" size={15} />
            Manage projects
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function ProjectDirectoryPage() {
  const navigation = useAppNavigation();
  const { data: organizationData } = useUserOrganizations();
  const selectedOrganizationId = useOrganizationStore(
    (state) => state.selectedOrgId
  );
  const [query, setQuery] = useState('');
  const projectsQuery = useInfiniteQuery({
    queryKey: ['project-directory'],
    queryFn: ({ pageParam }) =>
      executionDataApi.listProjects({ cursor: pageParam, limit: 50 }),
    initialPageParam: null as ProjectCursor | null,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    staleTime: 30_000,
  });
  const {
    fetchNextPage,
    hasNextPage,
    isFetchNextPageError,
    isFetchingNextPage,
  } = projectsQuery;

  const projects = useMemo(
    () =>
      (projectsQuery.data?.pages ?? []).reduce(
        (items, page) => mergeStableCursorItems(items, page.projects),
        [] as ProjectListItem[]
      ),
    [projectsQuery.data?.pages]
  );
  const filteredProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? projects.filter((project) =>
          project.name.toLocaleLowerCase().includes(normalized)
        )
      : projects;
  }, [projects, query]);
  const searchIsHydrating =
    Boolean(query.trim()) && Boolean(hasNextPage) && isFetchingNextPage;

  useEffect(() => {
    if (
      !query.trim() ||
      !hasNextPage ||
      isFetchingNextPage ||
      isFetchNextPageError
    ) {
      return;
    }
    void fetchNextPage();
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchNextPageError,
    isFetchingNextPage,
    query,
  ]);
  const organizationId =
    organizationData?.organizations.find(
      (organization) => organization.id === selectedOrganizationId
    )?.id ??
    organizationData?.organizations[0]?.id ??
    null;

  const createProject = async () => {
    if (!organizationId) return;
    const result = await CreateRemoteProjectDialog.show({ organizationId });
    if (result.action === 'created' && result.project) {
      await projectsQuery.refetch();
      navigation.goToProject(result.project.id);
    }
  };

  return (
    <section className="vk-project-directory" aria-labelledby="projects-title">
      <header className="vk-project-directory__header">
        <div>
          <p>Workspace</p>
          <h1 id="projects-title">Projects</h1>
        </div>
        <button
          type="button"
          className="vk-primary-action"
          onClick={() => void createProject()}
          disabled={!organizationId}
          title={organizationId ? undefined : 'No organization is available'}
        >
          <Plus aria-hidden="true" size={16} />
          New project
        </button>
      </header>

      <label className="vk-project-search">
        <Search aria-hidden="true" size={16} />
        <span className="vk-visually-hidden">Search projects</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search projects"
        />
      </label>

      {projectsQuery.isLoading ? (
        <div className="vk-project-directory__state" role="status">
          <LoaderCircle className="vk-spin" aria-hidden="true" size={18} />
          Loading projects
        </div>
      ) : projectsQuery.isError && projects.length === 0 ? (
        <div className="vk-project-directory__state" role="alert">
          <span>Projects could not be loaded.</span>
          <button type="button" onClick={() => void projectsQuery.refetch()}>
            Retry
          </button>
        </div>
      ) : filteredProjects.length === 0 && !searchIsHydrating ? (
        <div className="vk-project-directory__state">
          {query ? 'No projects match this search.' : 'No projects yet.'}
        </div>
      ) : (
        <>
          <div className="vk-project-grid">
            {filteredProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => navigation.goToProject(project.id)}
                onManage={() =>
                  void SettingsDialog.show({
                    initialSection: 'organizations',
                  })
                }
              />
            ))}
          </div>
          {searchIsHydrating ? (
            <div className="vk-project-directory__progress" role="status">
              <LoaderCircle className="vk-spin" aria-hidden="true" size={16} />
              Searching remaining projects…
            </div>
          ) : null}
        </>
      )}

      {projectsQuery.isFetchNextPageError && projects.length > 0 ? (
        <div className="vk-project-directory__page-error" role="alert">
          <span>More projects could not be loaded.</span>
          <button
            type="button"
            onClick={() => void projectsQuery.fetchNextPage()}
          >
            Retry
          </button>
        </div>
      ) : null}

      {projectsQuery.hasNextPage && !query.trim() ? (
        <button
          type="button"
          className="vk-project-directory__load-more"
          onClick={() => void projectsQuery.fetchNextPage()}
          disabled={projectsQuery.isFetchingNextPage}
        >
          {projectsQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </section>
  );
}
