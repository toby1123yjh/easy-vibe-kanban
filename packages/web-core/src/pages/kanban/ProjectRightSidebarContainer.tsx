import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownIcon, ArrowsOutIcon, XIcon } from '@phosphor-icons/react';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useUserContext } from '@/shared/hooks/useUserContext';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { ExecutionProcessesProvider } from '@/shared/providers/ExecutionProcessesProvider';
import { ApprovalFeedbackProvider } from '@/features/workspace-chat/model/contexts/ApprovalFeedbackContext';
import { EntriesProvider } from '@/features/workspace-chat/model/contexts/EntriesContext';
import { MessageEditProvider } from '@/features/workspace-chat/model/contexts/MessageEditContext';
import { CreateModeProvider } from '@/features/create-mode/model/CreateModeProvider';
import { useWorkspaceSessions } from '@/shared/hooks/useWorkspaceSessions';
import { useWorkspaceRecord } from '@/shared/hooks/useWorkspaceRecord';
import { SessionChatBoxContainer } from '@/features/workspace-chat/ui/SessionChatBoxContainer';
import { CreateChatBoxContainer } from '@/shared/components/CreateChatBoxContainer';
import { KanbanTaskPanelContainer } from './KanbanTaskPanelContainer';
import {
  ConversationList,
  type ConversationListHandle,
} from '@/features/workspace-chat/ui/ConversationListContainer';
import { RetryUiProvider } from '@/features/workspace-chat/model/contexts/RetryUiContext';
import { createWorkspaceWithSession } from '@/shared/types/attempt';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useCurrentKanbanRouteState } from '@/shared/hooks/useCurrentKanbanRouteState';
import {
  buildKanbanTaskComposerKey,
  closeKanbanTaskComposer,
  openKanbanTaskComposer,
  useKanbanTaskComposer,
} from '@/shared/stores/useKanbanTaskComposerStore';

interface WorkspaceSessionPanelProps {
  workspaceId: string;
  onClose: () => void;
}

interface WorkspaceCreatePanelProps {
  linkedTaskId: string | null;
  linkedTaskSimpleId: string | null;
  onOpenTask: (taskId: string) => void;
  onClose: () => void;
  children: ReactNode;
}

type TaskPanelResolution = 'resolving' | 'ready' | 'missing';

type RightPanelState =
  | { kind: 'closed' }
  | { kind: 'create-issue' }
  | { kind: 'task'; taskId: string; resolution: TaskPanelResolution }
  | { kind: 'task-workspace'; workspaceId: string }
  | { kind: 'workspace-create'; draftId: string; taskId: string | null };

function resolveTaskPanelResolution({
  taskId,
  hasTask,
  isProjectLoading,
  expectedTaskId,
}: {
  taskId: string;
  hasTask: boolean;
  isProjectLoading: boolean;
  expectedTaskId: string | null;
}): TaskPanelResolution {
  if (isProjectLoading) {
    return 'resolving';
  }

  if (hasTask) {
    return 'ready';
  }

  if (expectedTaskId === taskId) {
    return 'resolving';
  }

  return 'missing';
}

function WorkspaceCreatePanel({
  linkedTaskId,
  linkedTaskSimpleId,
  onOpenTask,
  onClose,
  children,
}: WorkspaceCreatePanelProps) {
  const { t } = useTranslation('tasks');
  const breadcrumbButtonClass =
    'min-w-0 text-sm text-normal truncate rounded-sm px-1 py-0.5 hover:bg-panel hover:text-high transition-colors';

  const handleOpenTask = useCallback(() => {
    if (linkedTaskId) {
      onOpenTask(linkedTaskId);
      return;
    }
    onClose();
  }, [linkedTaskId, onOpenTask, onClose]);

  return (
    <div className="relative flex h-full flex-1 flex-col bg-primary">
      <div className="flex items-center justify-between px-base py-half border-b shrink-0">
        <div className="flex items-center gap-half min-w-0 font-ibm-plex-mono">
          <button
            type="button"
            onClick={handleOpenTask}
            className={`${breadcrumbButtonClass} shrink-0`}
            aria-label="Open linked task"
          >
            {linkedTaskSimpleId ?? 'Task'}
          </button>
          <span className="text-low text-sm shrink-0">/</span>
          <span className={breadcrumbButtonClass}>
            {t('createWorkspaceFromPr.createWorkspace')}
          </span>
        </div>
        <div className="flex items-center gap-half">
          <button
            type="button"
            onClick={onClose}
            className="p-half rounded-sm text-low hover:text-normal hover:bg-panel transition-colors"
            aria-label="Close create workspace view"
          >
            <XIcon className="size-icon-sm" weight="bold" />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}

function WorkspaceSessionPanel({
  workspaceId,
  onClose,
}: WorkspaceSessionPanelProps) {
  const appNavigation = useAppNavigation();
  const { projectId, getTask } = useProjectContext();
  const routeState = useCurrentKanbanRouteState();
  const { workspaces: remoteWorkspaces } = useUserContext();
  const { activeWorkspaces, archivedWorkspaces } = useWorkspaceContext();
  const conversationListRef = useRef<ConversationListHandle>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const { data: workspace, isLoading: isWorkspaceLoading } = useWorkspaceRecord(
    workspaceId,
    { enabled: !!workspaceId }
  );
  const {
    sessions,
    selectedSession,
    selectedSessionId,
    selectSession,
    isLoading: isSessionsLoading,
    isNewSessionMode,
    startNewSession,
  } = useWorkspaceSessions(workspaceId, { enabled: !!workspaceId });

  const workspaceSummary = useMemo(
    () =>
      [...activeWorkspaces, ...archivedWorkspaces].find(
        (workspace) => workspace.id === workspaceId
      ),
    [activeWorkspaces, archivedWorkspaces, workspaceId]
  );

  const linkedWorkspace = useMemo(
    () =>
      remoteWorkspaces.find(
        (ws) =>
          ws.local_workspace_id === workspaceId && ws.project_id === projectId
      ) ?? null,
    [remoteWorkspaces, workspaceId, projectId]
  );

  const linkedTaskId = linkedWorkspace?.task_id ?? null;
  const breadcrumbTaskId = routeState.taskId ?? linkedTaskId;

  const taskSimpleId = useMemo(() => {
    if (!breadcrumbTaskId) return null;
    return getTask(breadcrumbTaskId)?.simple_id ?? null;
  }, [breadcrumbTaskId, getTask]);

  const workspaceBranch = workspace?.branch ?? workspaceSummary?.branch ?? null;

  const handleOpenTaskPanel = useCallback(() => {
    if (projectId && breadcrumbTaskId) {
      appNavigation.goToProjectTask(projectId, breadcrumbTaskId);
      return;
    }
    onClose();
  }, [projectId, breadcrumbTaskId, appNavigation, onClose]);

  const handleOpenWorkspaceView = useCallback(() => {
    appNavigation.goToWorkspace(workspaceId);
  }, [appNavigation, workspaceId]);

  const breadcrumbButtonClass =
    'min-w-0 text-sm text-normal truncate rounded-sm px-1 py-0.5 hover:bg-panel hover:text-high transition-colors';

  const workspaceWithSession = useMemo(() => {
    if (!workspace) return undefined;
    return createWorkspaceWithSession(workspace, selectedSession);
  }, [workspace, selectedSession]);

  const handleScrollToPreviousMessage = useCallback(() => {
    conversationListRef.current?.scrollToPreviousUserMessage();
  }, []);

  const handleScrollToUserMessage = useCallback((patchKey: string) => {
    conversationListRef.current?.scrollToEntryByPatchKey(patchKey);
  }, []);

  const handleGetActiveTurnPatchKey = useCallback(() => {
    return conversationListRef.current?.getVisibleUserMessagePatchKey() ?? null;
  }, []);

  const handleScrollToBottom = useCallback(
    (behavior: 'auto' | 'smooth' = 'smooth') => {
      conversationListRef.current?.scrollToBottom(behavior);
    },
    []
  );

  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    setIsAtBottom(atBottom);
  }, []);

  return (
    <ExecutionProcessesProvider
      key={`${workspaceId}-${selectedSessionId ?? 'new'}`}
      sessionId={selectedSessionId}
    >
      <ApprovalFeedbackProvider>
        <EntriesProvider
          key={`${workspaceId}-${selectedSessionId ?? 'new'}`}
          sessionId={selectedSessionId}
        >
          <MessageEditProvider>
            <div className="relative flex h-full flex-1 flex-col bg-primary">
              <div className="flex items-center justify-between px-base py-half border-b shrink-0">
                <div className="flex items-center gap-half min-w-0 font-ibm-plex-mono">
                  <button
                    type="button"
                    onClick={handleOpenTaskPanel}
                    className={`${breadcrumbButtonClass} shrink-0`}
                    aria-label="Open linked task"
                  >
                    {taskSimpleId ?? 'Task'}
                  </button>
                  <span className="text-low text-sm shrink-0">/</span>
                  <button
                    type="button"
                    onClick={handleOpenWorkspaceView}
                    className={breadcrumbButtonClass}
                    aria-label="Open workspace"
                  >
                    {workspaceBranch ?? 'Workspace'}
                  </button>
                </div>

                <div className="flex items-center gap-half">
                  <button
                    type="button"
                    onClick={handleOpenWorkspaceView}
                    className="p-half rounded-sm text-low hover:text-normal hover:bg-panel transition-colors"
                    aria-label="Open in workspace view"
                  >
                    <ArrowsOutIcon className="size-icon-sm" weight="bold" />
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-half rounded-sm text-low hover:text-normal hover:bg-panel transition-colors"
                    aria-label="Close conversation view"
                  >
                    <XIcon className="size-icon-sm" weight="bold" />
                  </button>
                </div>
              </div>

              {workspaceWithSession ? (
                <div className="flex flex-1 min-h-0 overflow-hidden justify-center">
                  <div className="w-chat max-w-full h-full">
                    <RetryUiProvider workspaceId={workspaceWithSession.id}>
                      <ConversationList
                        key={`${workspaceId}-${selectedSessionId ?? 'new'}`}
                        ref={conversationListRef}
                        attempt={workspaceWithSession}
                        onAtBottomChange={handleAtBottomChange}
                        sessionScopeId={selectedSessionId}
                      />
                    </RetryUiProvider>
                  </div>
                </div>
              ) : (
                <div className="flex-1" />
              )}

              {workspaceWithSession && !isAtBottom && (
                <div className="flex justify-center pointer-events-none">
                  <div className="w-chat max-w-full relative">
                    <button
                      type="button"
                      onClick={() => handleScrollToBottom('auto')}
                      className="absolute bottom-2 right-4 z-10 pointer-events-auto flex items-center justify-center size-8 rounded-full bg-secondary/80 backdrop-blur-sm border border-secondary text-low hover:text-normal hover:bg-secondary shadow-md transition-all"
                      aria-label="Scroll to bottom"
                      title="Scroll to bottom"
                    >
                      <ArrowDownIcon className="size-icon-base" weight="bold" />
                    </button>
                  </div>
                </div>
              )}

              <div className="flex justify-center @container pl-px">
                <SessionChatBoxContainer
                  {...(isSessionsLoading || isWorkspaceLoading
                    ? {
                        mode: 'placeholder' as const,
                      }
                    : isNewSessionMode
                      ? {
                          mode: 'new-session' as const,
                          workspaceId,
                          onSelectSession: selectSession,
                        }
                      : selectedSession
                        ? {
                            mode: 'existing-session' as const,
                            session: selectedSession,
                            onSelectSession: selectSession,
                            onStartNewSession: startNewSession,
                          }
                        : {
                            mode: 'placeholder' as const,
                          })}
                  sessions={sessions}
                  filesChanged={workspaceSummary?.filesChanged ?? 0}
                  linesAdded={workspaceSummary?.linesAdded ?? 0}
                  linesRemoved={workspaceSummary?.linesRemoved ?? 0}
                  diffStatsUnavailable={workspaceSummary?.filesChanged == null}
                  disableViewCode
                  showOpenWorkspaceButton
                  onScrollToPreviousMessage={handleScrollToPreviousMessage}
                  onScrollToBottom={handleScrollToBottom}
                  onScrollToUserMessage={handleScrollToUserMessage}
                  getActiveTurnPatchKey={handleGetActiveTurnPatchKey}
                />
              </div>
            </div>
          </MessageEditProvider>
        </EntriesProvider>
      </ApprovalFeedbackProvider>
    </ExecutionProcessesProvider>
  );
}

export function ProjectRightSidebarContainer() {
  const appNavigation = useAppNavigation();
  const {
    projectId,
    getTask,
    isLoading: isProjectLoading,
    tasksById,
  } = useProjectContext();
  const routeState = useCurrentKanbanRouteState();
  const { taskId, workspaceId, draftId, isWorkspaceCreateMode, hostId } =
    routeState;
  const taskComposerKey = useMemo(() => {
    if (!projectId) {
      return null;
    }

    return buildKanbanTaskComposerKey(hostId, projectId);
  }, [hostId, projectId]);
  const taskComposer = useKanbanTaskComposer(taskComposerKey);
  const isCreateMode = taskComposer !== null;
  // Kanban creation always starts with an Issue. Standalone creation belongs
  // to the workspace entrypoint, even when it selects this same project.
  useEffect(() => {
    if (!isWorkspaceCreateMode || taskId || !taskComposerKey) return;
    if (!taskComposer) openKanbanTaskComposer(taskComposerKey);
    appNavigation.goToProject(projectId, { replace: true });
  }, [
    isWorkspaceCreateMode,
    taskId,
    taskComposerKey,
    taskComposer,
    appNavigation,
    projectId,
  ]);
  const openTask = useCallback(
    (targetTaskId: string) => {
      if (!projectId) {
        return;
      }

      if (isCreateMode && taskComposerKey) {
        closeKanbanTaskComposer(taskComposerKey);
      }

      appNavigation.goToProjectTask(projectId, targetTaskId);
    },
    [projectId, isCreateMode, taskComposerKey, appNavigation]
  );
  const openTaskWorkspace = useCallback(
    (targetTaskId: string, targetWorkspaceId: string) => {
      if (!projectId) {
        return;
      }

      appNavigation.goToProjectTaskWorkspace(
        projectId,
        targetTaskId,
        targetWorkspaceId
      );
    },
    [projectId, appNavigation]
  );
  const closePanel = useCallback(() => {
    if (!projectId) {
      return;
    }

    if (isCreateMode && taskComposerKey) {
      closeKanbanTaskComposer(taskComposerKey);
    }

    appNavigation.goToProject(projectId);
  }, [projectId, isCreateMode, taskComposerKey, appNavigation]);
  const [expectedTaskId, setExpectedTaskId] = useState<string | null>(null);

  const markExpectedTask = useCallback((nextTaskId: string) => {
    setExpectedTaskId(nextTaskId);
  }, []);

  // Keep transient create expectations scoped to the current issue route only.
  useEffect(() => {
    if (!expectedTaskId) {
      return;
    }

    if (!taskId || taskId !== expectedTaskId) {
      setExpectedTaskId(null);
      return;
    }

    if (tasksById.has(expectedTaskId)) {
      setExpectedTaskId(null);
    }
  }, [expectedTaskId, taskId, tasksById]);

  const taskPanelResolution = useMemo<TaskPanelResolution | null>(() => {
    if (!taskId || isCreateMode || workspaceId || isWorkspaceCreateMode) {
      return null;
    }

    return resolveTaskPanelResolution({
      taskId,
      hasTask: tasksById.has(taskId),
      isProjectLoading,
      expectedTaskId,
    });
  }, [
    taskId,
    isCreateMode,
    workspaceId,
    isWorkspaceCreateMode,
    tasksById,
    isProjectLoading,
    expectedTaskId,
  ]);

  const rightPanelState = useMemo<RightPanelState>(() => {
    if (isCreateMode) {
      return { kind: 'create-issue' };
    }

    if (isWorkspaceCreateMode) {
      if (draftId) {
        return {
          kind: 'workspace-create',
          draftId,
          taskId,
        };
      }
      return { kind: 'closed' };
    }

    if (workspaceId) {
      return { kind: 'task-workspace', workspaceId };
    }

    if (taskId) {
      return {
        kind: 'task',
        taskId,
        resolution: taskPanelResolution ?? 'resolving',
      };
    }

    return { kind: 'closed' };
  }, [
    isWorkspaceCreateMode,
    draftId,
    taskId,
    workspaceId,
    isCreateMode,
    taskPanelResolution,
  ]);

  const handleOpenTaskFromCreate = useCallback(
    (targetTaskId: string) => {
      openTask(targetTaskId);
    },
    [openTask]
  );

  const handleWorkspaceCreated = useCallback(
    (createdWorkspaceId: string) => {
      if (taskId) {
        openTaskWorkspace(taskId, createdWorkspaceId);
        return;
      }

      appNavigation.goToWorkspace(createdWorkspaceId);
    },
    [taskId, openTaskWorkspace, appNavigation]
  );

  useEffect(() => {
    if (rightPanelState.kind !== 'task') {
      return;
    }

    if (rightPanelState.resolution !== 'missing') {
      return;
    }

    closePanel();
  }, [rightPanelState, closePanel]);

  if (rightPanelState.kind === 'workspace-create') {
    const linkedTaskId = rightPanelState.taskId;
    if (!linkedTaskId) return null;
    const linkedTaskSimpleId = linkedTaskId
      ? (getTask(linkedTaskId)?.simple_id ?? null)
      : null;

    return (
      <WorkspaceCreatePanel
        linkedTaskId={linkedTaskId}
        linkedTaskSimpleId={linkedTaskSimpleId}
        onOpenTask={handleOpenTaskFromCreate}
        onClose={closePanel}
      >
        <CreateModeProvider
          key={rightPanelState.draftId}
          draftId={rightPanelState.draftId}
        >
          <CreateChatBoxContainer
            onWorkspaceCreated={handleWorkspaceCreated}
            requiredLinkedTask={{
              taskId: linkedTaskId,
              remoteProjectId: projectId,
              simpleId: linkedTaskSimpleId ?? linkedTaskId,
              title: getTask(linkedTaskId)?.title,
            }}
          />
        </CreateModeProvider>
      </WorkspaceCreatePanel>
    );
  }

  if (rightPanelState.kind === 'task-workspace') {
    return (
      <WorkspaceSessionPanel
        workspaceId={rightPanelState.workspaceId}
        onClose={closePanel}
      />
    );
  }

  if (rightPanelState.kind === 'closed') {
    return null;
  }

  return (
    <KanbanTaskPanelContainer
      taskResolution={
        rightPanelState.kind === 'task' ? rightPanelState.resolution : null
      }
      onExpectTaskOpen={markExpectedTask}
    />
  );
}
