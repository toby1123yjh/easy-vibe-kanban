import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { TaskCursor, TaskSummary } from 'shared/types';
import { mergeStableCursorItems } from '@/features/app-shell/model/appShell';
import { ProjectRightSidebarContainer } from '@/pages/kanban/ProjectRightSidebarContainer';
import { Actions } from '@/shared/actions';
import { useActions } from '@/shared/hooks/useActions';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useCurrentKanbanRouteState } from '@/shared/hooks/useCurrentKanbanRouteState';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { executionDataApi } from '@/shared/lib/executionDataApi';
import { bulkUpdateIssues } from '@/shared/lib/remoteApi';
import {
  buildKanbanIssueComposerKey,
  openKanbanIssueComposer,
  useKanbanIssueComposer,
} from '@/shared/stores/useKanbanIssueComposerStore';
import {
  buildKanbanColumns,
  groupTopLevelTasksByIssue,
  type KanbanMoveUpdate,
} from '../model/project-kanban';
import { IssueFloatingPanelContainer } from './IssueFloatingPanelContainer';
import { ProjectKanbanView } from './ProjectKanbanView';

interface ProjectKanbanContainerProps {
  projectName: string;
  projectSource?: {
    title: string;
    description?: string;
    retry(): void;
    retrying?: boolean;
  };
}

const REMOTE_ARENA_UNAVAILABLE_REASON =
  'Arena comparison is unavailable in this deployment.';

type SharedSearchNavigate = (options: {
  search(previous: Record<string, unknown>): Record<string, unknown>;
  replace?: boolean;
}) => Promise<void>;

export function ProjectKanbanContainer({
  projectName,
  projectSource,
}: ProjectKanbanContainerProps) {
  const navigateSearch = useNavigate() as unknown as SharedSearchNavigate;
  const search = useSearch({ strict: false }) as {
    q?: string;
    session_id?: string;
  };
  const appNavigation = useAppNavigation();
  const { executeAction } = useActions();
  const routeState = useCurrentKanbanRouteState();
  const { projectId, issues, statuses, tags, issueTags, getIssue } =
    useProjectContext();
  const issueTriggerRef = useRef<HTMLElement | null>(null);
  const requestedTaskCursorRef = useRef<string | null>(null);
  const composerKey = useMemo(
    () => buildKanbanIssueComposerKey(routeState.hostId, projectId),
    [projectId, routeState.hostId]
  );
  const issueComposer = useKanbanIssueComposer(composerKey);

  const tasksQuery = useInfiniteQuery({
    queryKey: ['project-tasks', projectId],
    queryFn: ({ pageParam }) =>
      executionDataApi.listTasks({
        projectId,
        cursor: pageParam,
        limit: 100,
      }),
    initialPageParam: null as TaskCursor | null,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    staleTime: 10_000,
  });
  const {
    data: taskPages,
    fetchNextPage,
    isError: isTaskSourceError,
    isFetchNextPageError,
    isFetching: isTaskSourceFetching,
    isFetchingNextPage,
    isPending: isTaskSourcePending,
    refetch: refetchTasks,
  } = tasksQuery;

  useEffect(() => {
    const nextCursor = taskPages?.pages.at(-1)?.next_cursor;
    if (!nextCursor || isFetchingNextPage) return;

    const cursorKey = `${nextCursor.updated_at}:${nextCursor.id}`;
    if (requestedTaskCursorRef.current === cursorKey) return;

    requestedTaskCursorRef.current = cursorKey;
    void fetchNextPage();
  }, [fetchNextPage, isFetchingNextPage, taskPages?.pages]);

  const tasks = useMemo(
    () =>
      (taskPages?.pages ?? []).reduce(
        (items, page) => mergeStableCursorItems(items, page.tasks),
        [] as TaskSummary[]
      ),
    [taskPages?.pages]
  );
  const tasksByIssue = useMemo(() => groupTopLevelTasksByIssue(tasks), [tasks]);
  const columns = useMemo(
    () =>
      buildKanbanColumns({
        statuses,
        issues,
        tags,
        issueTags,
        tasks,
        query: search.q ?? '',
      }),
    [issueTags, issues, search.q, statuses, tags, tasks]
  );
  const selectedIssue = routeState.issueId
    ? getIssue(routeState.issueId)
    : undefined;
  const showCanonicalIssuePanel =
    selectedIssue !== undefined &&
    !routeState.workspaceId &&
    !routeState.isWorkspaceCreateMode &&
    issueComposer === null;
  const showLegacyDeepPanel =
    issueComposer !== null ||
    routeState.workspaceId !== null ||
    routeState.isWorkspaceCreateMode;

  useEffect(() => {
    if (
      routeState.issueId &&
      !selectedIssue &&
      !routeState.isWorkspaceCreateMode
    ) {
      appNavigation.goToProject(projectId, { replace: true });
    }
  }, [
    appNavigation,
    projectId,
    routeState.isWorkspaceCreateMode,
    routeState.issueId,
    selectedIssue,
  ]);

  const updateSearch = useCallback(
    (q: string) => {
      void navigateSearch({
        search: (previous) => ({
          ...previous,
          q: q.trim() ? q : undefined,
        }),
        replace: true,
      });
    },
    [navigateSearch]
  );

  const openIssue = useCallback(
    (issueId: string, trigger: HTMLElement) => {
      issueTriggerRef.current = trigger;
      appNavigation.goToProjectIssue(projectId, issueId);
    },
    [appNavigation, projectId]
  );

  const closePanel = useCallback(() => {
    const trigger = issueTriggerRef.current;
    const issueId = routeState.issueId;
    appNavigation.goToProject(projectId, { replace: true });
    requestAnimationFrame(() => {
      const fallback = issueId
        ? document.querySelector<HTMLElement>(`[data-issue-id="${issueId}"]`)
        : null;
      (trigger?.isConnected ? trigger : fallback)?.focus({
        preventScroll: true,
      });
    });
  }, [appNavigation, projectId, routeState.issueId]);

  const openTask = useCallback(
    (task: TaskSummary) => {
      const target = task.open_target;
      switch (target.kind) {
        case 'agent':
          appNavigation.goToProjectIssueWorkspace(
            projectId,
            task.issue_id,
            target.workspace_id
          );
          return;
        case 'workflow':
          if (target.latest_run_id) {
            appNavigation.goToProjectWorkflowRun(
              projectId,
              target.latest_run_id
            );
          } else {
            appNavigation.goToProjectWorkflowEdit(
              projectId,
              target.workflow_id
            );
          }
          return;
        case 'arena': {
          appNavigation.goToProjectIssueArena?.(
            projectId,
            task.issue_id,
            target.arena_group_id
          );
        }
      }
    },
    [appNavigation, projectId]
  );
  const getTaskUnavailableReason = useCallback(
    (task: TaskSummary) => {
      switch (task.open_target.kind) {
        case 'agent':
          return appNavigation.agentExecutionUnavailableReason ?? null;
        case 'workflow':
          return appNavigation.projectWorkflowUnavailableReason ?? null;
        case 'arena':
          return appNavigation.goToProjectIssueArena
            ? null
            : REMOTE_ARENA_UNAVAILABLE_REASON;
      }
    },
    [
      appNavigation.agentExecutionUnavailableReason,
      appNavigation.goToProjectIssueArena,
      appNavigation.projectWorkflowUnavailableReason,
    ]
  );

  const retryTaskSource = useCallback(() => {
    if (isFetchNextPageError) {
      requestedTaskCursorRef.current = null;
      void fetchNextPage();
      return;
    }
    void refetchTasks();
  }, [fetchNextPage, isFetchNextPageError, refetchTasks]);

  const taskSource = useMemo(() => {
    if (isTaskSourcePending) {
      return {
        state: 'loading' as const,
        title: 'Loading execution tasks…',
      };
    }
    if (isTaskSourceError && tasks.length === 0) {
      return {
        state: 'degraded' as const,
        title: 'Execution tasks are unavailable.',
        description: 'Issue data is still shown.',
        retry: retryTaskSource,
        retrying: isTaskSourceFetching,
      };
    }
    if (isFetchNextPageError) {
      return {
        state: 'degraded' as const,
        title: 'Some execution tasks could not be loaded.',
        retry: retryTaskSource,
        retrying: isTaskSourceFetching,
      };
    }
    if (isTaskSourceError) {
      return {
        state: 'degraded' as const,
        title: 'Execution tasks could not be refreshed.',
        description: 'Previously loaded tasks remain available.',
        retry: retryTaskSource,
        retrying: isTaskSourceFetching,
      };
    }
    if (isFetchingNextPage) {
      return {
        state: 'loading' as const,
        title: 'Loading remaining execution tasks…',
      };
    }
    return { state: 'ready' as const };
  }, [
    retryTaskSource,
    tasks.length,
    isFetchNextPageError,
    isFetchingNextPage,
    isTaskSourceFetching,
    isTaskSourceError,
    isTaskSourcePending,
  ]);

  const moveIssues = useCallback(async (updates: KanbanMoveUpdate[]) => {
    await bulkUpdateIssues(
      updates.map((update) => ({
        id: update.id,
        changes: {
          status_id: update.statusId,
          sort_order: update.sortOrder,
        },
      }))
    );
  }, []);
  const deleteIssue = useCallback(
    async (issueId: string) => {
      await executeAction(Actions.DeleteIssue, undefined, projectId, [issueId]);
    },
    [executeAction, projectId]
  );

  const panel =
    showCanonicalIssuePanel && selectedIssue ? (
      <aside className="vk-issue-floating-panel" aria-label="Issue details">
        <IssueFloatingPanelContainer
          key={selectedIssue.id}
          issue={selectedIssue}
          tasks={tasksByIssue.get(selectedIssue.id) ?? []}
          onClose={closePanel}
          onOpenTask={openTask}
          getTaskUnavailableReason={getTaskUnavailableReason}
          agentUnavailableReason={
            appNavigation.agentExecutionUnavailableReason ?? null
          }
          workflowUnavailableReason={
            appNavigation.projectWorkflowUnavailableReason ?? null
          }
          arenaUnavailableReason={
            appNavigation.goToProjectIssueArena
              ? null
              : REMOTE_ARENA_UNAVAILABLE_REASON
          }
        />
      </aside>
    ) : showLegacyDeepPanel ? (
      <aside className="vk-issue-floating-panel" aria-label="Issue activity">
        <ProjectRightSidebarContainer />
      </aside>
    ) : null;

  return (
    <ProjectKanbanView
      projectName={projectName}
      columns={columns}
      issueCount={columns.reduce(
        (count, column) => count + column.issues.length,
        0
      )}
      query={search.q ?? ''}
      selectedIssueId={routeState.issueId}
      dragDisabled={Boolean(search.q?.trim())}
      projectSource={projectSource}
      taskSource={taskSource}
      panel={panel}
      onQueryChange={updateSearch}
      onCreateIssue={(statusId) =>
        openKanbanIssueComposer(composerKey, { statusId })
      }
      onOpenIssue={openIssue}
      onOpenTask={openTask}
      onDeleteIssue={deleteIssue}
      getTaskUnavailableReason={getTaskUnavailableReason}
      onMove={moveIssues}
    />
  );
}
