import { useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import {
  useUiPreferencesStore,
  useWorkspacePanelState,
  type LayoutMode,
} from '@/shared/stores/useUiPreferencesStore';
import { useDiffViewMode } from '@/shared/stores/useDiffViewStore';
import { useDiffPaths } from '@/shared/stores/useWorkspaceDiffStore';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { useDevServer } from '@/shared/hooks/useDevServer';
import { useBranchStatus } from '@/shared/hooks/useBranchStatus';
import { useShape } from '@/shared/integrations/electric/hooks';
import { useExecutionProcessesContext } from '@/shared/hooks/useExecutionProcessesContext';
import { useLogsPanel } from '@/shared/hooks/useLogsPanel';
import { useAuth } from '@/shared/hooks/auth/useAuth';
import { isProjectDestination } from '@/shared/lib/routes/appNavigation';
import { useCurrentAppDestination } from '@/shared/hooks/useCurrentAppDestination';
import { useCurrentKanbanRouteState } from '@/shared/hooks/useCurrentKanbanRouteState';
import { PROJECT_TASKS_SHAPE } from 'shared/remote-types';
import type { Merge } from 'shared/types';
import type {
  ActionVisibilityContext,
  DevServerState,
} from '@/shared/types/actions';

interface ActionVisibilityOptions {
  projectId?: string;
  taskIds?: string[];
}

/**
 * Hook that builds the visibility context from stores/context.
 * Used by command surfaces to evaluate
 * action visibility and state conditions.
 */
export function useActionVisibilityContext(
  options?: ActionVisibilityOptions
): ActionVisibilityContext {
  const { workspace, workspaceId, isCreateMode, repos } = useWorkspaceContext();
  // Use workspace-specific panel state (pass undefined when in create mode)
  const panelState = useWorkspacePanelState(
    isCreateMode ? undefined : workspaceId
  );
  const diffPathsSet = useDiffPaths();
  const diffViewMode = useDiffViewMode();
  const expanded = useUiPreferencesStore((s) => s.expanded);

  // Derive kanban state from URL (URL is single source of truth)
  const { projectId: routeProjectId, taskId: routeTaskId } = useParams({
    strict: false,
  });
  const destination = useCurrentAppDestination();
  const { isCreateMode: kanbanCreateMode } = useCurrentKanbanRouteState();
  const effectiveProjectId = options?.projectId ?? routeProjectId;
  const optionTaskIds = options?.taskIds;
  const effectiveTaskIds = useMemo(
    () => optionTaskIds ?? (routeTaskId ? [routeTaskId] : []),
    [optionTaskIds, routeTaskId]
  );
  const hasSelectedKanbanTask = effectiveTaskIds.length > 0;
  const shouldResolveSelectedTaskParent =
    !!effectiveProjectId && effectiveTaskIds.length === 1;

  const projectTasksParams = useMemo(
    () => ({ project_id: effectiveProjectId ?? '' }),
    [effectiveProjectId]
  );
  const { data: projectTasks } = useShape(
    PROJECT_TASKS_SHAPE,
    projectTasksParams,
    {
      enabled: shouldResolveSelectedTaskParent,
    }
  );
  const hasSelectedKanbanTaskParent = useMemo(() => {
    if (!shouldResolveSelectedTaskParent) return false;
    const selectedTask = projectTasks.find(
      (task) => task.id === effectiveTaskIds[0]
    );
    return !!selectedTask?.parent_task_id;
  }, [shouldResolveSelectedTaskParent, projectTasks, effectiveTaskIds]);

  // Derive layoutMode from current route instead of persisted state
  const layoutMode: LayoutMode = isProjectDestination(destination)
    ? 'kanban'
    : 'workspaces';
  const { config } = useUserSystem();
  const { isStarting, isStopping, runningDevServers } =
    useDevServer(workspaceId);
  const { data: branchStatus } = useBranchStatus(workspaceId);
  const { isAttemptRunningVisible } = useExecutionProcessesContext();
  const { logsPanelContent } = useLogsPanel();
  const { isSignedIn } = useAuth();

  return useMemo(() => {
    // Compute isAllDiffsExpanded
    const diffPaths = Array.from(diffPathsSet);
    const diffKeys = diffPaths.map((p: string) => `diff:${p}`);
    const isAllDiffsExpanded =
      diffKeys.length > 0 &&
      diffKeys.every((k: string) => expanded[k] !== false);

    // Compute dev server state
    const devServerState: DevServerState = isStarting
      ? 'starting'
      : isStopping
        ? 'stopping'
        : runningDevServers.length > 0
          ? 'running'
          : 'stopped';

    // Compute git state from branch status
    const hasOpenPR =
      branchStatus?.some((repo) =>
        repo.merges?.some(
          (m: Merge) => m.type === 'pr' && m.pr_info.status === 'open'
        )
      ) ?? false;

    const hasUnpushedCommits =
      branchStatus?.some((repo) => (repo.remote_commits_ahead ?? 0) > 0) ??
      false;

    return {
      layoutMode,
      rightMainPanelMode: panelState.rightMainPanelMode,
      isLeftSidebarVisible: panelState.isLeftSidebarVisible,
      isLeftMainPanelVisible: panelState.isLeftMainPanelVisible,
      isRightSidebarVisible: panelState.isRightSidebarVisible,
      isCreateMode,
      hasWorkspace: !!workspace,
      workspaceArchived: workspace?.archived ?? false,
      hasDiffs: diffPathsSet.size > 0,
      diffViewMode,
      isAllDiffsExpanded,
      editorType: config?.editor?.editor_type ?? null,
      devServerState,
      runningDevServers,
      hasGitRepos: repos.length > 0,
      hasMultipleRepos: repos.length > 1,
      hasOpenPR,
      hasUnpushedCommits,
      isAttemptRunning: isAttemptRunningVisible,
      logsPanelContent,
      hasSelectedKanbanTask,
      hasSelectedKanbanTaskParent,
      isCreatingTask: kanbanCreateMode,
      isSignedIn,
    };
  }, [
    layoutMode,
    panelState.rightMainPanelMode,
    panelState.isLeftSidebarVisible,
    panelState.isLeftMainPanelVisible,
    panelState.isRightSidebarVisible,
    isCreateMode,
    workspace,
    repos,
    diffPathsSet,
    diffViewMode,
    expanded,
    config?.editor?.editor_type,
    isStarting,
    isStopping,
    runningDevServers,
    branchStatus,
    isAttemptRunningVisible,
    logsPanelContent,
    hasSelectedKanbanTask,
    hasSelectedKanbanTaskParent,
    kanbanCreateMode,
    isSignedIn,
  ]);
}
