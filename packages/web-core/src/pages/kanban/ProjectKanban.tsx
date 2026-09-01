import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@vibe/ui/components/Button';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@vibe/ui/components/StateSurface';
import { LoginRequiredPrompt } from '@/shared/dialogs/shared/LoginRequiredPrompt';
import { ProjectKanbanContainer } from '@/features/projects/ui/ProjectKanbanContainer';
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
  buildKanbanIssueComposerKey,
  closeKanbanIssueComposer,
} from '@/shared/stores/useKanbanIssueComposerStore';
import { useOrganizationStore } from '@/shared/stores/useOrganizationStore';

/**
 * Component that registers project mutations with ActionsContext.
 * Must be rendered inside both ActionsProvider and ProjectProvider.
 */
function ProjectMutationsRegistration({ children }: { children: ReactNode }) {
  const { registerProjectMutations } = useActions();
  const { removeIssue, insertIssue, getIssue, getAssigneesForIssue, issues } =
    useProjectContext();

  // Use ref to always access latest issues and avoid stale closures.
  const issuesRef = useRef(issues);
  useEffect(() => {
    issuesRef.current = issues;
  }, [issues]);

  useEffect(() => {
    registerProjectMutations({
      removeIssue: (id) => {
        removeIssue(id);
      },
      duplicateIssue: (issueId) => {
        const issue = getIssue(issueId);
        if (!issue) return;

        const currentIssues = issuesRef.current;
        const statusIssues = currentIssues.filter(
          (candidate) => candidate.status_id === issue.status_id
        );
        const minSortOrder =
          statusIssues.length > 0
            ? Math.min(...statusIssues.map((candidate) => candidate.sort_order))
            : 0;

        insertIssue({
          project_id: issue.project_id,
          status_id: issue.status_id,
          title: `${issue.title} (Copy)`,
          description: issue.description,
          priority: issue.priority,
          sort_order: minSortOrder - 1,
          start_date: issue.start_date,
          target_date: issue.target_date,
          completed_at: null,
          parent_issue_id: issue.parent_issue_id,
          parent_issue_sort_order: issue.parent_issue_sort_order,
          extension_metadata: issue.extension_metadata,
        });
      },
      getIssue,
      getAssigneesForIssue,
    });

    return () => {
      registerProjectMutations(null);
    };
  }, [
    registerProjectMutations,
    removeIssue,
    insertIssue,
    getIssue,
    getAssigneesForIssue,
  ]);

  return <>{children}</>;
}

function ProjectKanbanInner({ projectId }: { projectId: string }) {
  const { t } = useTranslation('common');
  const { projects, isLoading, error, retry } = useOrgContext();

  const project = projects.find((candidate) => candidate.id === projectId);

  if (isLoading && !project) {
    return (
      <LoadingState
        className="h-full w-full bg-[var(--vk-surface-canvas)]"
        title={t('states.loading')}
      />
    );
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
  const { issueId } = useCurrentKanbanRouteState();
  const { getIssue, isLoading, error, retry } = useProjectContext();
  const issue = issueId ? getIssue(issueId) : undefined;
  const hasLoadedBoardRef = useRef(false);
  if (!isLoading && !error) {
    hasLoadedBoardRef.current = true;
  }
  usePageTitle(issue?.title, projectName);

  if (isLoading) {
    return (
      <LoadingState
        className="h-full w-full bg-[var(--vk-surface-canvas)]"
        title="Loading project board…"
      />
    );
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
    <ProjectKanbanContainer
      projectName={projectName}
      projectSource={projectSource}
    />
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
  const orgIdToUse = selectedOrgId ?? organizations[0]?.id ?? null;

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
    organizationId: project?.organization_id ?? selectedOrgId,
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
 * - /projects/:projectId/issues/:issueId - Kanban with issue panel open
 * - /projects/:projectId/issues/:issueId/workspaces/:workspaceId - Kanban with workspace session panel open
 * - /projects/:projectId/issues/:issueId/workspaces/create/:draftId - Kanban with workspace create panel
 *
 * Note: issue creation is composer-store state on top of /projects/:projectId.
 *
 * Note: This component is rendered inside SharedAppLayout which provides
 * NavbarContainer, AppBar, and SyncErrorProvider.
 */
export function ProjectKanban() {
  const { projectId, hostId, hasInvalidWorkspaceCreateDraftId } =
    useCurrentKanbanRouteState();
  const appNavigation = useAppNavigation();
  const { t } = useTranslation('common');
  const { isSignedIn, isLoaded: authLoaded } = useAuth();
  const issueComposerKey = useMemo(() => {
    if (!projectId) {
      return null;
    }
    return buildKanbanIssueComposerKey(hostId, projectId);
  }, [hostId, projectId]);
  const previousIssueComposerKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const previousKey = previousIssueComposerKeyRef.current;
    if (previousKey && previousKey !== issueComposerKey) {
      closeKanbanIssueComposer(previousKey);
    }

    previousIssueComposerKeyRef.current = issueComposerKey;
  }, [issueComposerKey]);

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

  // Show loading while auth state is being determined
  if (!authLoaded || isLoading) {
    return (
      <LoadingState
        className="h-full w-full bg-[var(--vk-surface-canvas)]"
        title={t('states.loading')}
      />
    );
  }

  // If not signed in, prompt user to log in
  if (!isSignedIn) {
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

  if (error && (!projectId || !organizationId)) {
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

  if (!projectId || !organizationId) {
    return (
      <EmptyState
        className="h-full w-full bg-[var(--vk-surface-canvas)]"
        title={t('kanban.noProjectFound')}
      />
    );
  }

  return (
    <OrgProvider key={organizationId} organizationId={organizationId}>
      <ProjectKanbanInner key={projectId} projectId={projectId} />
    </OrgProvider>
  );
}
