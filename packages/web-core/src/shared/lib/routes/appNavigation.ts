export type AppDestination =
  | { kind: 'root' }
  | { kind: 'onboarding' }
  | { kind: 'onboarding-sign-in' }
  | { kind: 'workspaces'; hostId?: string }
  | { kind: 'workspaces-create'; hostId?: string }
  | { kind: 'workspace'; workspaceId: string; hostId?: string }
  | { kind: 'workspace-vscode'; workspaceId: string; hostId?: string }
  | { kind: 'export' }
  | { kind: 'project-directory'; hostId?: string }
  | { kind: 'workflow-directory'; hostId?: string }
  | { kind: 'project'; projectId: string; hostId?: string }
  | { kind: 'project-workflows'; projectId: string; hostId?: string }
  | {
      kind: 'project-workflow-edit';
      projectId: string;
      workflowId: string;
      hostId?: string;
    }
  | {
      kind: 'project-workflow-run';
      projectId: string;
      runId: string;
      hostId?: string;
    }
  | {
      kind: 'project-task';
      hostId?: string;
      projectId: string;
      taskId: string;
    }
  | {
      kind: 'project-task-arena';
      hostId?: string;
      projectId: string;
      taskId: string;
      arenaGroupId: string;
    }
  | {
      kind: 'project-task-workspace';
      projectId: string;
      taskId: string;
      workspaceId: string;
      hostId?: string;
    }
  | {
      kind: 'project-task-workspace-create';
      projectId: string;
      taskId: string;
      draftId: string;
      hostId?: string;
    }
  | {
      kind: 'project-workspace-create';
      projectId: string;
      draftId: string;
      hostId?: string;
    };

export type NavigationTransition = {
  replace?: boolean;
  /** Explicit machine for a newly opened local project; null selects this host. */
  hostId?: string | null;
};

export type SettingsNavigationSection =
  | 'application'
  | 'repositories'
  | 'integrations'
  | 'relay'
  | 'organizations'
  | 'projects';

export const SETTINGS_NAVIGATION_TABS = ['general', 'host', 'cloud'] as const;

export type SettingsNavigationTab = (typeof SETTINGS_NAVIGATION_TABS)[number];

export const SETTINGS_NAVIGATION_SECTIONS: Readonly<
  Record<SettingsNavigationTab, readonly SettingsNavigationSection[]>
> = {
  general: ['application'],
  host: ['repositories', 'integrations'],
  cloud: ['relay', 'organizations', 'projects'],
};

export interface SettingsNavigationTarget {
  tab: SettingsNavigationTab;
  section: SettingsNavigationSection;
  host?: string;
  projectId?: string;
}

export function getSettingsNavigationTarget(
  section: SettingsNavigationSection,
  host?: string | null,
  projectId?: string
): SettingsNavigationTarget {
  const tab = SETTINGS_NAVIGATION_TABS.find((candidate) =>
    SETTINGS_NAVIGATION_SECTIONS[candidate].includes(section)
  );
  if (!tab) {
    throw new Error(`Settings section has no owner: ${section}`);
  }

  return {
    tab,
    section,
    ...(host ? { host } : {}),
    ...(section === 'projects' && projectId ? { projectId } : {}),
  };
}

export interface AppNavigation {
  /**
   * Present when the current deployment cannot open or create Agent execution
   * surfaces (for example, Remote without an online Host).
   */
  agentExecutionUnavailableReason?: string;
  /**
   * Present when this deployment has no canonical Workflow authoring/runtime
   * route. Shared project surfaces must fail closed instead of navigating to a
   * fallback page.
   */
  projectWorkflowUnavailableReason?: string;
  resolveFromPath(path: string): AppDestination | null;
  goToRoot(transition?: NavigationTransition): void;
  goToOnboarding(transition?: NavigationTransition): void;
  goToOnboardingSignIn(transition?: NavigationTransition): void;
  goToWorkspaces(transition?: NavigationTransition): void;
  goToWorkspacesCreate(transition?: NavigationTransition): void;
  goToWorkspace(workspaceId: string, transition?: NavigationTransition): void;
  goToWorkspaceVsCode(
    workspaceId: string,
    transition?: NavigationTransition
  ): void;
  goToExport(transition?: NavigationTransition): void;
  goToProject(projectId: string, transition?: NavigationTransition): void;
  goToProjectWorkflows(
    projectId: string,
    transition?: NavigationTransition
  ): void;
  goToProjectWorkflowEdit(
    projectId: string,
    workflowId: string,
    transition?: NavigationTransition
  ): void;
  goToProjectWorkflowRun(
    projectId: string,
    runId: string,
    transition?: NavigationTransition
  ): void;
  goToProjectTask(
    projectId: string,
    taskId: string,
    transition?: NavigationTransition
  ): void;
  /**
   * Only deployments with an Arena comparison route provide this action.
   * Consumers must fail closed when it is absent.
   */
  goToProjectTaskArena?(
    projectId: string,
    taskId: string,
    arenaGroupId: string,
    transition?: NavigationTransition
  ): void;
  goToProjectTaskWorkspace(
    projectId: string,
    taskId: string,
    workspaceId: string,
    transition?: NavigationTransition
  ): void;
  goToProjectTaskWorkspaceCreate(
    projectId: string,
    taskId: string,
    draftId: string,
    transition?: NavigationTransition
  ): void;
  goToProjectWorkspaceCreate(
    projectId: string,
    draftId: string,
    transition?: NavigationTransition
  ): void;
}

type ProjectDestinationKind =
  | 'project'
  | 'project-workflows'
  | 'project-workflow-edit'
  | 'project-workflow-run'
  | 'project-task'
  | 'project-task-arena'
  | 'project-task-workspace'
  | 'project-task-workspace-create'
  | 'project-workspace-create';

type WorkspaceDestinationKind =
  | 'workspaces'
  | 'workspaces-create'
  | 'workspace'
  | 'workspace-vscode';

export type ProjectDestination = Extract<
  AppDestination,
  { kind: ProjectDestinationKind }
>;

export type WorkspaceDestination = Extract<
  AppDestination,
  { kind: WorkspaceDestinationKind }
>;

export type KanbanSidebarMode =
  | 'closed'
  | 'task'
  | 'task-workspace'
  | 'workspace-create';

export interface KanbanRouteState {
  hostId: string | null;
  projectId: string | null;
  taskId: string | null;
  workspaceId: string | null;
  draftId: string | null;
  sidebarMode: KanbanSidebarMode | null;
  isCreateMode: boolean;
  isWorkspaceCreateMode: boolean;
  hasInvalidWorkspaceCreateDraftId: boolean;
  isPanelOpen: boolean;
}

export function getDestinationHostId(
  destination: AppDestination | null
): string | null {
  if (!destination || !('hostId' in destination)) {
    return null;
  }

  return destination.hostId ?? null;
}

export function isProjectDestination(
  destination: AppDestination | null
): destination is ProjectDestination {
  if (!destination) {
    return false;
  }

  switch (destination.kind) {
    case 'project':
    case 'project-workflows':
    case 'project-workflow-edit':
    case 'project-workflow-run':
    case 'project-task':
    case 'project-task-arena':
    case 'project-task-workspace':
    case 'project-task-workspace-create':
    case 'project-workspace-create':
      return true;
    default:
      return false;
  }
}

export function isWorkspacesDestination(
  destination: AppDestination | null
): destination is WorkspaceDestination {
  if (!destination) {
    return false;
  }

  switch (destination.kind) {
    case 'workspaces':
    case 'workspaces-create':
    case 'workspace':
    case 'workspace-vscode':
      return true;
    default:
      return false;
  }
}

export function isLocalWorkspacesDestination(
  destination: AppDestination | null
): destination is WorkspaceDestination {
  return (
    isWorkspacesDestination(destination) &&
    getDestinationHostId(destination) === null
  );
}

export function isRemoteWorkspacesDestination(
  destination: AppDestination | null
): destination is WorkspaceDestination {
  return (
    isWorkspacesDestination(destination) &&
    getDestinationHostId(destination) !== null
  );
}

export function getProjectDestination(
  destination: AppDestination | null
): ProjectDestination | null {
  return isProjectDestination(destination) ? destination : null;
}

function isValidUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function resolveKanbanRouteState(
  destination: AppDestination | null
): KanbanRouteState {
  const projectDestination = getProjectDestination(destination);
  const projectId = projectDestination?.projectId ?? null;
  const hostId = getDestinationHostId(projectDestination);

  const taskId = (() => {
    if (!projectDestination) {
      return null;
    }

    switch (projectDestination.kind) {
      case 'project-task':
      case 'project-task-arena':
      case 'project-task-workspace':
      case 'project-task-workspace-create':
        return projectDestination.taskId;
      default:
        return null;
    }
  })();

  const workspaceId =
    projectDestination?.kind === 'project-task-workspace'
      ? projectDestination.workspaceId
      : null;

  const rawDraftId =
    projectDestination?.kind === 'project-task-workspace-create' ||
    projectDestination?.kind === 'project-workspace-create'
      ? projectDestination.draftId
      : null;
  const draftId = rawDraftId && isValidUuid(rawDraftId) ? rawDraftId : null;

  const hasInvalidWorkspaceCreateDraftId =
    (projectDestination?.kind === 'project-task-workspace-create' ||
      projectDestination?.kind === 'project-workspace-create') &&
    rawDraftId !== null &&
    !draftId;

  const isWorkspaceCreateMode =
    (projectDestination?.kind === 'project-task-workspace-create' ||
      projectDestination?.kind === 'project-workspace-create') &&
    draftId !== null;

  const sidebarMode = (() => {
    if (!projectDestination) {
      return null;
    }

    switch (projectDestination.kind) {
      case 'project':
      case 'project-workflows':
      case 'project-workflow-edit':
      case 'project-workflow-run':
      case 'project-task-arena':
        return 'closed';
      case 'project-task':
        return 'task';
      case 'project-task-workspace':
        return 'task-workspace';
      case 'project-task-workspace-create':
      case 'project-workspace-create':
        return 'workspace-create';
    }
  })();

  return {
    hostId,
    projectId,
    taskId,
    workspaceId,
    draftId,
    sidebarMode,
    // Issue-create mode is route-independent and derived from composer state.
    isCreateMode: false,
    isWorkspaceCreateMode,
    hasInvalidWorkspaceCreateDraftId,
    isPanelOpen: !!projectDestination && projectDestination.kind !== 'project',
  };
}
