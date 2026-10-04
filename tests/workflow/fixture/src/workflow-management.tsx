import { useState } from 'react';
import { useLocation } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { WorkflowLandingPage } from '@/features/workflow/ui/WorkflowLandingPage';
import { WorkflowTemplateEditorPage } from '@/features/workflow/ui/WorkflowTemplateEditorPage';
import { WorkflowMainSessionButton } from '@/features/workflow/ui/WorkflowMainSessionButton';
import { workflowNotificationEntries } from '@/features/workflow/model/workflowNotifications';
import { AppNavigationProvider } from '@/shared/hooks/useAppNavigation';
import { AppShellProjectsProvider } from '@/shared/hooks/useAppShellProjects';
import {
  ProjectContext,
  type ProjectContextValue,
} from '@/shared/hooks/useProjectContext';
import {
  UserContext,
  type UserContextValue,
} from '@/shared/hooks/useUserContext';
import {
  WorkspaceContext,
  type WorkspaceContextValue,
} from '@/shared/hooks/useWorkspaceContext';
import { useWorkflowNotifications } from '@/shared/hooks/useWorkflowManagement';
import type { AppNavigation } from '@/shared/lib/routes/appNavigation';

const timestamp = '2026-10-04T01:00:00Z';

function unexpectedNavigation(): never {
  throw new Error('Workflow management read/open must not launch an execution');
}

// Use the real navigation/context contracts. Only destinations not used in
// these tests fail closed; the exact Session route uses the real router.
const navigation: AppNavigation = {
  resolveFromPath: () => null,
  goToRoot: unexpectedNavigation,
  goToOnboarding: unexpectedNavigation,
  goToOnboardingSignIn: unexpectedNavigation,
  goToWorkspaces: unexpectedNavigation,
  goToWorkspacesCreate: unexpectedNavigation,
  goToWorkspace: unexpectedNavigation,
  goToWorkspaceVsCode: unexpectedNavigation,
  goToExport: unexpectedNavigation,
  goToProject: unexpectedNavigation,
  goToProjectWorkflows: unexpectedNavigation,
  goToProjectWorkflowEdit: unexpectedNavigation,
  goToProjectWorkflowRun: unexpectedNavigation,
  goToProjectIssue: unexpectedNavigation,
  goToProjectIssueWorkspace: unexpectedNavigation,
  goToProjectIssueWorkspaceCreate: unexpectedNavigation,
  goToProjectWorkspaceCreate: unexpectedNavigation,
};

// The editor only needs read-side Project/User/Workspace lookups. Fail closed
// if a tested read/open path unexpectedly tries to create unrelated entities.
const projectContext: ProjectContextValue = {
  projectId: 'project-one',
  issues: [],
  statuses: [],
  tags: [],
  issueAssignees: [],
  issueFollowers: [],
  issueTags: [],
  issueRelationships: [],
  pullRequests: [],
  pullRequestIssues: [],
  workspaces: [],
  isLoading: false,
  error: null,
  retry: () => undefined,
  insertIssue: unexpectedNavigation,
  updateIssue: unexpectedNavigation,
  removeIssue: unexpectedNavigation,
  insertStatus: unexpectedNavigation,
  updateStatus: unexpectedNavigation,
  removeStatus: unexpectedNavigation,
  insertTag: unexpectedNavigation,
  updateTag: unexpectedNavigation,
  removeTag: unexpectedNavigation,
  insertIssueAssignee: unexpectedNavigation,
  removeIssueAssignee: unexpectedNavigation,
  insertIssueFollower: unexpectedNavigation,
  removeIssueFollower: unexpectedNavigation,
  insertIssueTag: unexpectedNavigation,
  removeIssueTag: unexpectedNavigation,
  insertIssueRelationship: unexpectedNavigation,
  removeIssueRelationship: unexpectedNavigation,
  insertPullRequestIssue: unexpectedNavigation,
  removePullRequestIssue: unexpectedNavigation,
  getIssue: () => undefined,
  getIssuesForStatus: () => [],
  getAssigneesForIssue: () => [],
  getFollowersForIssue: () => [],
  getTagsForIssue: () => [],
  getTagObjectsForIssue: () => [],
  getRelationshipsForIssue: () => [],
  getStatus: () => undefined,
  getTag: () => undefined,
  getPullRequestsForIssue: () => [],
  getWorkspacesForIssue: () => [],
  issuesById: new Map(),
  statusesById: new Map(),
  tagsById: new Map(),
};
const userContext: UserContextValue = {
  workspaces: [],
  isLoading: false,
  error: null,
  retry: () => undefined,
  getWorkspacesForIssue: () => [],
};
const workspaceContext: WorkspaceContextValue = {
  workspaceId: undefined,
  workspace: undefined,
  activeWorkspaces: [],
  archivedWorkspaces: [],
  workspaceListState: 'empty',
  isWorkspacesListLoading: false,
  isWorkspacesListRetrying: false,
  workspaceListError: null,
  retryWorkspaces: async () => undefined,
  isLoading: false,
  isWorkspaceLoading: false,
  workspaceError: null,
  retryWorkspace: async () => undefined,
  isCreateMode: false,
  selectWorkspace: unexpectedNavigation,
  navigateToCreate: unexpectedNavigation,
  sessions: [],
  selectedSession: undefined,
  selectedSessionId: undefined,
  selectSession: unexpectedNavigation,
  selectLatestSession: unexpectedNavigation,
  isSessionsLoading: false,
  sessionsError: null,
  retrySessions: async () => undefined,
  isNewSessionMode: false,
  startNewSession: unexpectedNavigation,
  repos: [],
  isReposLoading: false,
  reposError: null,
  retryRepos: async () => undefined,
};

function EditorHarness() {
  return (
    <ProjectContext.Provider value={projectContext}>
      <UserContext.Provider value={userContext}>
        <WorkspaceContext.Provider value={workspaceContext}>
          <WorkflowTemplateEditorPage
            projectId="project-one"
            workflowId="report-template"
          />
        </WorkspaceContext.Provider>
      </UserContext.Provider>
    </ProjectContext.Provider>
  );
}

export function WorkflowManagementNavigationProbe() {
  const location = useLocation();
  return (
    <output data-testid="management-location" hidden>
      {JSON.stringify({
        pathname: location.pathname,
        search: location.search,
      })}
    </output>
  );
}

function NotificationHarness() {
  const { t } = useTranslation('common');
  const [sessionId, setSessionId] = useState('main-session');
  const { context, notifications } = useWorkflowNotifications(sessionId);
  const entries = workflowNotificationEntries(
    notifications.data ?? [],
    sessionId,
    {
      heading: t('workflow.management.notification'),
      resolved: t('workflow.management.resolved'),
      pending: t('workflow.management.pending'),
      status: (status) =>
        t(`workflow.management.status.${status}`, { defaultValue: status }),
    }
  );

  return (
    <section>
      <button type="button" onClick={() => void notifications.refetch()}>
        Refresh notifications
      </button>
      <button type="button" onClick={() => setSessionId('other-session')}>
        Open another Session
      </button>
      <output data-testid="main-session-context">
        {JSON.stringify(context.data ?? null)}
      </output>
      {notifications.isError ? <p role="alert">Refresh failed</p> : null}
      <ol data-testid="workflow-system-messages">
        {entries.map((entry) =>
          entry.type === 'NORMALIZED_ENTRY' ? (
            <li key={entry.patchKey} data-message-key={entry.patchKey}>
              {entry.content.content}
            </li>
          ) : null
        )}
      </ol>
    </section>
  );
}

export function WorkflowManagementHarness() {
  const params = new URLSearchParams(window.location.search);
  const [projectId, setProjectId] = useState<string>();
  const [projectRetries, setProjectRetries] = useState(0);
  const [projectPages, setProjectPages] = useState(0);
  const [openedRun, setOpenedRun] = useState<string>();
  const isRemote = params.get('remote') === '1';
  const blocked = params.get('blocked') === '1';
  const emptyProjects =
    params.get('projectsError') === '1' && projectRetries === 0;

  return (
    <AppNavigationProvider
      value={{
        ...navigation,
        goToProjectWorkflowRun: (_projectId, runId) => setOpenedRun(runId),
        ...(blocked
          ? { agentExecutionUnavailableReason: 'Host is offline' }
          : {}),
      }}
    >
      <AppShellProjectsProvider
        value={{
          scopeKey: isRemote ? 'remote-host' : 'workflow-management-fixture',
          deployment: isRemote ? 'remote' : 'local',
          hostId: isRemote ? 'remote-host' : null,
          items: emptyProjects
            ? []
            : [
                {
                  id: 'project-one',
                  name: 'Report project',
                  created_at: timestamp,
                  updated_at: timestamp,
                },
                {
                  id: 'project-two',
                  name: 'Research project',
                  created_at: timestamp,
                  updated_at: timestamp,
                },
              ],
          isLoading: false,
          isError: emptyProjects,
          isFetching: false,
          isFetchNextPageError: false,
          hasNextPage: projectPages === 0,
          isFetchingNextPage: false,
          retry: async () => setProjectRetries((count) => count + 1),
          loadNextPage: async () => setProjectPages((count) => count + 1),
        }}
      >
        <HotkeysProvider>
          <div
            data-testid="workflow-management"
            style={{ height: '100%', padding: 16 }}
          >
            {params.get('mode') === 'management-editor' ? (
              <EditorHarness />
            ) : params.get('mode') === 'management-notifications' ? (
              <NotificationHarness />
            ) : params.get('mode') === 'management-button' ? (
              <WorkflowMainSessionButton
                projectId="project-one"
                workflowId="report-template"
                issueId={params.get('issue') ?? undefined}
              />
            ) : (
              <WorkflowLandingPage
                projectId={projectId}
                onProjectChange={setProjectId}
              />
            )}
            <output data-testid="project-retries" hidden>
              {projectRetries}
            </output>
            <output data-testid="project-pages" hidden>
              {projectPages}
            </output>
            <output data-testid="opened-run" hidden>
              {openedRun}
            </output>
          </div>
        </HotkeysProvider>
      </AppShellProjectsProvider>
    </AppNavigationProvider>
  );
}
