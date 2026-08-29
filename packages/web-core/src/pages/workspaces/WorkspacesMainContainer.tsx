import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { Workspace, Session, RepoWithTargetBranch } from 'shared/types';
import { createWorkspaceWithSession } from '@/shared/types/attempt';
import { WorkspacesMain } from '@vibe/ui/components/WorkspacesMain';
import {
  ConversationList,
  type ConversationListHandle,
} from '@/features/workspace-chat/ui/ConversationListContainer';
import { SessionChatBoxContainer } from '@/features/workspace-chat/ui/SessionChatBoxContainer';
import { useWorkspacePendingApproval } from '@/features/workspace-chat/model/hooks/useWorkspacePendingApproval';
import { ContextBarContainer } from './ContextBarContainer';
import { EntriesProvider } from '@/features/workspace-chat/model/contexts/EntriesContext';
import { MessageEditProvider } from '@/features/workspace-chat/model/contexts/MessageEditContext';
import { RetryUiProvider } from '@/features/workspace-chat/model/contexts/RetryUiContext';
import { ApprovalFeedbackProvider } from '@/features/workspace-chat/model/contexts/ApprovalFeedbackContext';
import { forwardWheelToScroller } from '@/features/workspace-chat/ui/forwardWheelToScroller';
import { useDiffStats } from '@/shared/stores/useWorkspaceDiffStore';

/**
 * Isolated component that reads diffStats from WorkspaceContext.
 * By pushing the context subscription down to this leaf, the parent
 * WorkspacesMainContainer (and its ConversationList child) no longer
 * rerenders when diffs/comments/repos stream in.
 */
function ChatBoxWithDiffStats({
  session,
  workspaceId,
  isNewSessionMode,
  sessions,
  onSelectSession,
  onStartNewSession,
  onScrollToPreviousMessage,
  onScrollToBottom,
  onScrollToUserMessage,
  getActiveTurnPatchKey,
}: {
  session: Session | undefined;
  workspaceId: string | undefined;
  isNewSessionMode: boolean;
  sessions: Session[];
  onSelectSession: (sessionId: string) => void;
  onStartNewSession: () => void;
  onScrollToPreviousMessage: () => void;
  onScrollToBottom: (behavior?: 'auto' | 'smooth') => void;
  onScrollToUserMessage: (patchKey: string) => void;
  getActiveTurnPatchKey: () => string | null;
}) {
  const diffStats = useDiffStats();

  return (
    <SessionChatBoxContainer
      {...(isNewSessionMode && workspaceId
        ? {
            mode: 'new-session' as const,
            workspaceId,
            onSelectSession,
          }
        : session
          ? {
              mode: 'existing-session' as const,
              session,
              onSelectSession,
              onStartNewSession,
            }
          : {
              mode: 'placeholder' as const,
            })}
      sessions={sessions}
      filesChanged={diffStats.files_changed}
      linesAdded={diffStats.lines_added}
      linesRemoved={diffStats.lines_removed}
      disableViewCode={false}
      showOpenWorkspaceButton={false}
      onScrollToPreviousMessage={onScrollToPreviousMessage}
      onScrollToBottom={onScrollToBottom}
      onScrollToUserMessage={onScrollToUserMessage}
      getActiveTurnPatchKey={getActiveTurnPatchKey}
    />
  );
}

/** Locates the same canonical approval/input event rendered in the timeline. */
function AgentWorkbenchAttentionBannerContainer({
  onView,
}: {
  onView: () => void;
}) {
  const { t } = useTranslation('common');
  const pending = useWorkspacePendingApproval();
  if (!pending) return null;
  return (
    <div
      role="status"
      className="mx-auto flex w-chat max-w-full items-center gap-3 border-y border-warning/30 bg-warning/10 px-4 py-2 text-sm"
    >
      <span className="min-w-0 flex-1 truncate">
        {pending.kind === 'input'
          ? t('agentWorkbench.attention.waitingForInput', {
              defaultValue: 'Agent is waiting for input',
            })
          : t('agentWorkbench.attention.needsApproval', {
              toolName: pending.toolName,
              defaultValue: '{{toolName}} needs approval',
            })}
      </span>
      <button
        type="button"
        className="min-h-9 shrink-0 rounded px-3 font-medium text-foreground hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        onClick={onView}
      >
        {t('agentWorkbench.attention.viewEvent', {
          defaultValue: 'View event',
        })}
      </button>
    </div>
  );
}

export interface WorkspacesMainContainerHandle {
  scrollToBottom: (behavior?: 'auto' | 'smooth') => void;
}

interface WorkspacesMainContainerProps {
  selectedWorkspace: Workspace | null;
  selectedSession: Session | undefined;
  selectedSessionId: string | undefined;
  sessions: Session[];
  repos: RepoWithTargetBranch[];
  onSelectSession: (sessionId: string) => void;
  isLoading: boolean;
  isSessionsLoading?: boolean;
  isNewSessionMode: boolean;
  onStartNewSession: () => void;
}

export const WorkspacesMainContainer = forwardRef<
  WorkspacesMainContainerHandle,
  WorkspacesMainContainerProps
>(function WorkspacesMainContainer(
  {
    selectedWorkspace,
    selectedSession,
    selectedSessionId,
    sessions,
    repos,
    onSelectSession,
    isLoading,
    isNewSessionMode,
    onStartNewSession,
  },
  ref
) {
  const containerRef = useRef<HTMLElement>(null);
  const conversationListRef = useRef<ConversationListHandle>(null);

  const workspaceWithSession = useMemo(() => {
    if (!selectedWorkspace) return undefined;
    return createWorkspaceWithSession(selectedWorkspace, selectedSession);
  }, [selectedWorkspace, selectedSession]);

  const handleScrollToPreviousMessage = useCallback(() => {
    conversationListRef.current?.scrollToPreviousUserMessage();
  }, []);

  const handleScrollToUserMessage = useCallback((patchKey: string) => {
    conversationListRef.current?.scrollToEntryByPatchKey(patchKey);
  }, []);

  const handleGetActiveTurnPatchKey = useCallback(() => {
    return conversationListRef.current?.getVisibleUserMessagePatchKey() ?? null;
  }, []);

  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(isAtBottom);
  const handleAtBottomChange = useCallback((atBottom: boolean) => {
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);
  }, []);

  const handleScrollToBottom = useCallback(
    (behavior: 'auto' | 'smooth' = 'smooth') => {
      conversationListRef.current?.scrollToBottom(behavior);
    },
    []
  );

  const { session } = workspaceWithSession ?? {};

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const chatBoxContainer = container.querySelector<HTMLElement>(
      '[data-chatbox-container="true"]'
    );
    if (!chatBoxContainer) return;

    let previousHeight = chatBoxContainer.getBoundingClientRect().height;

    const observer = new ResizeObserver((entries) => {
      const nextHeight =
        entries[0]?.contentRect.height ??
        chatBoxContainer.getBoundingClientRect().height;

      if (Math.abs(nextHeight - previousHeight) < 0.5) return;
      const heightDelta = nextHeight - previousHeight;
      previousHeight = nextHeight;

      if (!isAtBottomRef.current) return;

      requestAnimationFrame(() => {
        if (!isAtBottomRef.current) return;
        conversationListRef.current?.adjustScrollBy(heightDelta);
      });
    });

    observer.observe(chatBoxContainer);

    return () => {
      observer.disconnect();
    };
  }, [workspaceWithSession?.id, session?.id]);

  const entriesProviderKey = workspaceWithSession
    ? `${workspaceWithSession.id}-${selectedSessionId ?? 'new'}`
    : 'empty';

  const conversationContent = workspaceWithSession ? (
    <div
      className="flex-1 min-h-0 overflow-hidden flex justify-center"
      onWheel={(e) => forwardWheelToScroller(e, conversationListRef)}
    >
      <div className="w-chat max-w-full h-full">
        <RetryUiProvider workspaceId={workspaceWithSession.id}>
          <ConversationList
            key={entriesProviderKey}
            ref={conversationListRef}
            attempt={workspaceWithSession}
            repos={repos}
            onAtBottomChange={handleAtBottomChange}
            sessionScopeId={selectedSessionId}
          />
        </RetryUiProvider>
      </div>
    </div>
  ) : null;

  const chatBoxContent = (
    <ChatBoxWithDiffStats
      session={session}
      workspaceId={workspaceWithSession?.id}
      isNewSessionMode={isNewSessionMode}
      sessions={sessions}
      onSelectSession={onSelectSession}
      onStartNewSession={onStartNewSession}
      onScrollToPreviousMessage={handleScrollToPreviousMessage}
      onScrollToBottom={handleScrollToBottom}
      onScrollToUserMessage={handleScrollToUserMessage}
      getActiveTurnPatchKey={handleGetActiveTurnPatchKey}
    />
  );

  const contextBarContent = workspaceWithSession ? (
    <ContextBarContainer containerRef={containerRef} />
  ) : null;

  const approvalBannerContent = workspaceWithSession ? (
    <AgentWorkbenchAttentionBannerContainer onView={handleScrollToBottom} />
  ) : null;

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom: (behavior = 'smooth') => {
        conversationListRef.current?.scrollToBottom(behavior);
      },
    }),
    []
  );

  return (
    <ApprovalFeedbackProvider>
      <EntriesProvider key={entriesProviderKey} sessionId={selectedSessionId}>
        <MessageEditProvider>
          <WorkspacesMain
            workspaceWithSession={
              workspaceWithSession ? { id: workspaceWithSession.id } : undefined
            }
            isLoading={isLoading}
            containerRef={containerRef}
            conversationContent={conversationContent}
            chatBoxContent={chatBoxContent}
            contextBarContent={contextBarContent}
            isAtBottom={isAtBottom}
            onAtBottomChange={handleAtBottomChange}
            onScrollToBottom={handleScrollToBottom}
            approvalBannerContent={approvalBannerContent}
          />
        </MessageEditProvider>
      </EntriesProvider>
    </ApprovalFeedbackProvider>
  );
});
