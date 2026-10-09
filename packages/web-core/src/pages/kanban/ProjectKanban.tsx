import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@vibe/ui/components/Button';
import { EmptyState, ErrorState } from '@vibe/ui/components/StateSurface';
import { LoginRequiredPrompt } from '@/shared/dialogs/shared/LoginRequiredPrompt';
import { ProjectKanbanContainer } from '@/features/projects/ui/ProjectKanbanContainer';
import { ProjectKanbanSkeleton } from '@/features/projects/ui/ProjectKanbanSkeleton';
import { DefaultProjectPage } from '@/features/projects/ui/ProjectSessions';
import { isDefaultProject } from '@/shared/lib/defaultProject';
import { useActions } from '@/shared/hooks/useActions';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useAuth } from '@/shared/hooks/auth/useAuth';
import { useCurrentKanbanRouteState } from '@/shared/hooks/useCurrentKanbanRouteState';
import { useOrgContext } from '@/shared/hooks/useOrgContext';
import { useOrganizationProjects } from '@/shared/hooks/useOrganizationProjects';
import { usePageTitle } from '@/shared/hooks/usePageTitle';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useUserOrganizations } from '@/shared/hooks/useUserOrganizations';
import { ProjectProvider } from '@/shared/providers/remote/ProjectProvider';
import { OrgProvider } from '@/shared/providers/remote/OrgProvider';
import {
  buildKanbanTaskComposerKey,
  closeKanbanTaskComposer,
} from '@/shared/stores/useKanbanTaskComposerStore';
import { useOrganizationStore } from '@/shared/stores/useOrganizationStore';
import { deriveProjectBoardAccessState } from '@/features/projects/model/projectBoardAccessState';

/**
 * Component that registers project mutations with ActionsContext.
 * Must be rendered inside both ActionsProvider and ProjectProvider.
 */
function ProjectMutationsRegistration({ children }: { children: ReactNode }) {
  const { registerProjectMutations } = useActions();
  const { removeTask, insertTask, getTask, getAssigneesForTask, tasks } =
    useProjectContext();

  // Use ref to always access latest issues and avoid stale closures.
  const tasksRef = useRef(tasks);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    registerProjectMutations({
      removeTask: (id) => {
        removeTask(id);
      },
      duplicateTask: (taskId) => {
        const task = getTask(taskId);
        if (!task) return;

        const currentTasks = tasksRef.current;
        const statusTasks = currentTasks.filter(
          (candidate) => candidate.status_id === task.status_id
        );
        const minSortOrder =
          statusTasks.length > 0
            ? Math.min(...statusTasks.map((candidate) => candidate.sort_order))
            : 0;

        insertTask({
          project_id: task.project_id,
          status_id: task.status_id,
          title: `${task.title} (Copy)`,
          description: task.description,
          priority: task.priority,
          sort_order: minSortOrder - 1,
          start_date: task.start_date,
          target_date: task.target_date,
          completed_at: null,
          parent_task_id: task.parent_task_id,
          parent_task_sort_order: task.parent_task_sort_order,
          extension_metadata: task.extension_metadata,
        });
      },
      getTask,
      getAssigneesForTask,
    });

    return () => {
      registerProjectMutations(null);
    };
  }, [
    registerProjectMutations,
    removeTask,
    insertTask,
    getTask,
    getAssigneesForTask,
  ]);

  return <>{children}</>;
}

function ProjectKanbanInner({ projectId }: { projectId: string }) {
  const { t } = useTranslation('common');
  const { projects, isLoading, error, retry } = useOrgContext();

  const project = projects.find((candidate) => candidate.id === projectId);

  if (project && isDefaultProject(projectId)) return <DefaultProjectPage />;

  if (isLoading && !project) {
    return <ProjectKanbanSkeleton />;
  }

  if (error && !project) {
    return (
      <ErrorState
        className="h-full w-full bg-[var(--vk-surface-canvas)]"
        title="The project could not be loaded."
        description={error.message}
        action={
          <Button type="button" variant="outline" onClick={retry}>
            {t('buttons.retry')}
          </Button>
        }
      />
    );
  }

  if (!project) {
    return (
      <EmptyState
        className="h-full w-full bg-[var(--vk-surface-canvas)]"
        title={t('kanban.noProjectFound')}
      />
    );
  }

  return (
    <ProjectProvider projectId={projectId}>
      <ProjectMutationsRegistration>
        <ProjectKanbanPageSurface
          projectName={project.name}
          organizationError={error?.message ?? null}
          retryOrganization={retry}
        />
      </ProjectMutationsRegistration>
    </ProjectProvider>
  );
}

function ProjectKanbanPageSurface({
  projectName,
  organizationError,
  retryOrganization,
}: {
  projectName: string;
  organizationError: string | null;
  retryOrganization(): void;
}) {
  const { t } = useTranslation('common');
  const { taskId } = useCurrentKanbanRouteState();
  const { getTask, isLoading, error, retry } = useProjectContext();
  const task = taskId ? getTask(taskId) : undefined;
  const hasLoadedBoardRef = useRef(false);
  if (!isLoading && !error) {
    hasLoadedBoardRef.current = true;
  }
  usePageTitle(task?.title, projectName);

  if (isLoading && !hasLoadedBoardRef.current) {
    return <ProjectKanbanSkeleton projectName={projectName} />;
  }

  if (error && !hasLoadedBoardRef.current) {
    return (
      <ErrorState
        className="h-full w-full bg-[var(--vk-surface-canvas)]"
        title="The project board could not be synced."
        description={error.message}
        action={
          <Button type="button" variant="outline" onClick={retry}>
            {t('buttons.retry')}
          </Button>
        }
      />
    );
  }

  const projectSource =
    error || organizationError
      ? {
          title: 'Some project data could not be refreshed.',
          description: [organizationError, error?.message]
            .filter(Boolean)
            .join(' '),
          retry: () => {
            retryOrganization();
            retry();
          },
        }
      : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <ProjectKanbanContainer
          projectName={projectName}
          projectSource={projectSource}
        />
      </div>
    </div>
  );
}

/**
 * Hook to find a project by ID, using orgId from Zustand store
 */
function useFindProjectById(projectId: string | undefined) {
  const { isLoaded: authLoaded } = useAuth();
  const organizationsQuery = useUserOrganizations();
  const {
    data: orgsData,
    error: organizationsError,
    isLoading: orgsLoading,
    refetch: refetchOrganizations,
  } = organizationsQuery;
  const selectedOrgId = useOrganizationStore((s) => s.selectedOrgId);
  const organizations = orgsData?.organizations ?? [];

  // Use stored org ID, or fall back to first org
  const orgIdToUse = organizations.some((org) => org.id === selectedOrgId)
    ? selectedOrgId
    : (organizations[0]?.id ?? null);

  const {
    data: projects = [],
    error: projectsError,
    isLoading: projectsLoading,
    retry: retryProjects,
  } = useOrganizationProjects(orgIdToUse);

  const project = useMemo(() => {
    if (!projectId) return undefined;
    return projects.find((candidate) => candidate.id === projectId);
  }, [projectId, projects]);
  const retry = useCallback(() => {
    void refetchOrganizations();
    retryProjects();
  }, [refetchOrganizations, retryProjects]);

  return {
    project,
    organizationId: project?.organization_id ?? null,
    // Include auth loading state - we can't determine project access until auth loads
    isLoading: !authLoaded || orgsLoading || projectsLoading,
    error: organizationsError ?? projectsError,
    retry,
  };
}

/**
 * ProjectKanban page - displays the Kanban board for a specific project
 *
 * URL patterns:
 * - /projects/:projectId - Kanban board with no issue selected
 * - /projects/:projectId/tasks/:issueId - Kanban with issue panel open
 * - /projects/:projectId/tasks/:issueId/workspaces/:workspaceId - Kanban with workspace session panel open
 * - /projects/:projectId/tasks/:issueId/workspaces/create/:draftId - Kanban with workspace create panel
 *
 * Note: issue creation is composer-store state on top of /projects/:projectId.
 *
 * Note: This component is rendered inside SharedAppLayout which provides
 * the shared App Shell and SyncErrorProvider.
 */
export function ProjectKanban() {
  const { projectId, hostId, hasInvalidWorkspaceCreateDraftId } =
    useCurrentKanbanRouteState();
  const appNavigation = useAppNavigation();
  const { t } = useTranslation('common');
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const taskComposerKey = useMemo(() => {
    if (!projectId) {
      return null;
    }
    return buildKanbanTaskComposerKey(hostId, projectId);
  }, [hostId, projectId]);
  const previousTaskComposerKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const previousKey = previousTaskComposerKeyRef.current;
    if (previousKey && previousKey !== taskComposerKey) {
      closeKanbanTaskComposer(previousKey);
    }

    previousTaskComposerKeyRef.current = taskComposerKey;
  }, [taskComposerKey]);

  // Redirect invalid workspace-create draft URLs back to the closed project view.
  useEffect(() => {
    if (!projectId) return;

    if (hasInvalidWorkspaceCreateDraftId) {
      appNavigation.goToProject(projectId, {
        replace: true,
      });
    }
  }, [projectId, hasInvalidWorkspaceCreateDraftId, appNavigation]);

  // Find the project and get its organization
  const { organizationId, isLoading, error, retry } = useFindProjectById(
    projectId ?? undefined
  );
  const accessState = deriveProjectBoardAccessState({
    authLoaded,
    isLoading,
    isSignedIn,
    hasResolutionError: Boolean(error),
    hasProjectIdentity: Boolean(projectId && organizationId),
  });

  // Show loading while auth state is being determined
  if (accessState === 'loading') {
    return <ProjectKanbanSkeleton />;
  }

  // If not signed in, prompt user to log in
  if (accessState === 'permission') {
    return (
      <div className="flex items-center justify-center h-full w-full p-base">
        <LoginRequiredPrompt
          className="max-w-md"
          title={t('kanban.loginRequired.title')}
          description={t('kanban.loginRequired.description')}
          actionLabel={t('kanban.loginRequired.action')}
        />
      </div>
    );
  }

  if (accessState === 'error' && error) {
    return (
      <ErrorState
        className="h-full w-full bg-[var(--vk-surface-canvas)]"
        title="The project could not be resolved."
        description={error.message}
        action={
          <Button type="button" variant="outline" onClick={retry}>
            {t('buttons.retry')}
          </Button>
        }
      />
    );
  }

  if (accessState === 'empty' || !projectId || !organizationId) {
    return (
      <EmptyState
        className="h-full w-full bg-[var(--vk-surface-canvas)]"
        title={t('kanban.noProjectFound')}
      />
    );
  }

  return (
    <OrgProvider
      key={`${hostId}:${organizationId}`}
      organizationId={organizationId}
    >
      <ProjectKanbanInner
        key={`${hostId}:${projectId}`}
        projectId={projectId}
      />
    </OrgProvider>
  );
}
