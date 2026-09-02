export type UtilityCollectionState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'degraded'
  | 'ready';

export interface UtilityCollectionFacts {
  hasItems: boolean;
  isLoading: boolean;
  error: unknown;
}

/**
 * Projects an async collection without turning a failed first read into an
 * empty result. Cached rows remain readable after a refresh failure.
 */
export function projectUtilityCollectionState({
  hasItems,
  isLoading,
  error,
}: UtilityCollectionFacts): UtilityCollectionState {
  if (error != null) {
    return hasItems ? 'degraded' : 'error';
  }

  if (isLoading && !hasItems) {
    return 'loading';
  }

  return hasItems ? 'ready' : 'empty';
}

export interface ExportSelectionFacts {
  organizationCount: number;
  organizationsLoading: boolean;
  organizationsError: unknown;
  selectedOrganizationId: string | null;
  projectCount: number;
  projectsLoading: boolean;
  projectsError: unknown;
}

export function projectExportSelectionState({
  organizationCount,
  organizationsLoading,
  organizationsError,
  selectedOrganizationId,
  projectCount,
  projectsLoading,
  projectsError,
}: ExportSelectionFacts): UtilityCollectionState {
  const organizationsState = projectUtilityCollectionState({
    hasItems: organizationCount > 0,
    isLoading: organizationsLoading,
    error: organizationsError,
  });

  if (organizationsState !== 'ready' && organizationsState !== 'degraded') {
    return organizationsState;
  }

  // The container derives this ID from the canonical organization list. A
  // missing ID is therefore a short first-render transition, not a fake empty
  // project result.
  if (!selectedOrganizationId) {
    return 'loading';
  }

  const projectsState = projectUtilityCollectionState({
    hasItems: projectCount > 0,
    isLoading: projectsLoading,
    error: projectsError,
  });

  if (projectsState === 'ready' && organizationsState === 'degraded') {
    return 'degraded';
  }

  return projectsState;
}

export interface ExportProjectSelection {
  organizationId: string;
  projectIds: string[];
}

/**
 * Initializes a new organization to all projects, then preserves the user's
 * choices across same-owner refreshes while dropping projects that vanished.
 */
export function reconcileExportProjectSelection(
  previous: ExportProjectSelection | null,
  organizationId: string,
  availableProjectIds: string[]
): ExportProjectSelection {
  if (previous?.organizationId !== organizationId) {
    return { organizationId, projectIds: availableProjectIds };
  }

  const availableIds = new Set(availableProjectIds);
  return {
    organizationId,
    projectIds: previous.projectIds.filter((id) => availableIds.has(id)),
  };
}

export interface EmbeddedWorkspaceFacts {
  hasWorkspace: boolean;
  workspaceLoading: boolean;
  workspaceError: unknown;
  sessionCount: number;
  sessionsLoading: boolean;
  sessionsError: unknown;
  reposError: unknown;
}

/**
 * The embedded workspace needs the Workspace and a trustworthy Session list.
 * Repositories enrich the conversation and may degrade independently.
 */
export function projectEmbeddedWorkspaceState({
  hasWorkspace,
  workspaceLoading,
  workspaceError,
  sessionCount,
  sessionsLoading,
  sessionsError,
  reposError,
}: EmbeddedWorkspaceFacts): UtilityCollectionState {
  if (!hasWorkspace) {
    if (workspaceError != null) return 'error';
    if (workspaceLoading) return 'loading';
    return 'empty';
  }

  if (sessionsError != null && sessionCount === 0) {
    return 'error';
  }

  if (sessionsLoading && sessionCount === 0) {
    return 'loading';
  }

  if (workspaceError != null || sessionsError != null || reposError != null) {
    return 'degraded';
  }

  return 'ready';
}
