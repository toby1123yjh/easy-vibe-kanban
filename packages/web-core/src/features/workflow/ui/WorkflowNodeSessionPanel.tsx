import { useCallback, useMemo, useRef, useState, type WheelEvent } from 'react';
import type { WorkflowNodeExecutionResponse } from 'shared/types';
import { Button } from '@vibe/ui/components/Button';
import { WorkspacesMain } from '@vibe/ui/components/WorkspacesMain';
import { ConversationList } from '@/features/workspace-chat/ui/ConversationListContainer';
import type { ConversationListHandle } from '@/features/workspace-chat/ui/ConversationListContainer';
import { SessionChatBoxContainer } from '@/features/workspace-chat/ui/SessionChatBoxContainer';
import { ApprovalFeedbackProvider } from '@/features/workspace-chat/model/contexts/ApprovalFeedbackContext';
import { EntriesProvider } from '@/features/workspace-chat/model/contexts/EntriesContext';
import { MessageEditProvider } from '@/features/workspace-chat/model/contexts/MessageEditContext';
import { RetryUiProvider } from '@/features/workspace-chat/model/contexts/RetryUiContext';
import { forwardWheelToScroller } from '@/features/workspace-chat/ui/forwardWheelToScroller';
import { ContextBarContainer } from '@/pages/workspaces/ContextBarContainer';
import { useWorkspaceRecord } from '@/shared/hooks/useWorkspaceRecord';
import { useWorkspaceRepo } from '@/shared/hooks/useWorkspaceRepo';
import { useWorkspaceSessions } from '@/shared/hooks/useWorkspaceSessions';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { ExecutionProcessesProvider } from '@/shared/providers/ExecutionProcessesProvider';
import { createWorkspaceWithSession } from '@/shared/types/attempt';

export function WorkflowNodeSessionPanel({
  execution,
  workspaceId,
  sessionHref,
  workspaceHref,
}: {
  execution: WorkflowNodeExecutionResponse;
  workspaceId: string | null;
  sessionHref: string | null;
  workspaceHref: string | null;
}) {
  const nodeSessionId = execution.session_id;

  if (!workspaceId || !nodeSessionId) {
    return (
      <WorkflowNodeSessionFallback
        execution={execution}
        sessionHref={sessionHref}
        workspaceHref={workspaceHref}
      />
    );
  }

  return (
    <WorkflowNodeEmbeddedSession
      execution={execution}
      nodeSessionId={nodeSessionId}
      sessionHref={sessionHref}
      workspaceId={workspaceId}
      workspaceHref={workspaceHref}
    />
  );
}

function WorkflowNodeEmbeddedSession({
  execution,
  nodeSessionId,
  sessionHref,
  workspaceId,
  workspaceHref,
}: {
  execution: WorkflowNodeExecutionResponse;
  nodeSessionId: string;
  sessionHref: string | null;
  workspaceId: string;
  workspaceHref: string | null;
}) {
  const containerRef = useRef<HTMLElement>(null);
  const conversationListRef = useRef<ConversationListHandle>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const { activeWorkspaces, archivedWorkspaces } = useWorkspaceContext();
  const { data: workspace, isLoading: isWorkspaceLoading } = useWorkspaceRecord(
    workspaceId,
    { enabled: !!workspaceId }
  );
  const { repos } = useWorkspaceRepo(workspaceId, { enabled: !!workspaceId });
  const {
    sessions,
    selectSession,
    isLoading: isSessionsLoading,
  } = useWorkspaceSessions(workspaceId, { enabled: !!workspaceId });

  const nodeSession = useMemo(
    () => sessions.find((session) => session.id === nodeSessionId),
    [nodeSessionId, sessions]
  );
  const nodeSessions = useMemo(
    () => (nodeSession ? [nodeSession] : []),
    [nodeSession]
  );

  const workspaceSummary = useMemo(
    () =>
      [...activeWorkspaces, ...archivedWorkspaces].find(
        (candidate) => candidate.id === workspaceId
      ),
    [activeWorkspaces, archivedWorkspaces, workspaceId]
  );

  const workspaceWithSession = useMemo(() => {
    if (!workspace) return undefined;
    return createWorkspaceWithSession(workspace, nodeSession);
  }, [workspace, nodeSession]);

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

  const entriesProviderKey = `${workspaceId}-${nodeSessionId}`;

  if (!isSessionsLoading && !nodeSession) {
    return (
      <WorkflowNodeSessionFallback
        execution={execution}
        sessionHref={sessionHref}
        workspaceHref={workspaceHref}
      />
    );
  }

  const conversationContent = workspaceWithSession ? (
    <div
      className="flex min-h-0 flex-1 justify-center overflow-hidden"
      onWheel={(event: WheelEvent<HTMLDivElement>) =>
        forwardWheelToScroller(event, conversationListRef)
      }
    >
      <div className="h-full w-chat max-w-full">
        <RetryUiProvider workspaceId={workspaceWithSession.id}>
          <ConversationList
            key={entriesProviderKey}
            ref={conversationListRef}
            attempt={workspaceWithSession}
            repos={repos}
            onAtBottomChange={handleAtBottomChange}
            sessionScopeId={nodeSessionId}
          />
        </RetryUiProvider>
      </div>
    </div>
  ) : null;

  const chatBoxContent = (
    <SessionChatBoxContainer
      {...(isSessionsLoading || isWorkspaceLoading
        ? {
            mode: 'placeholder' as const,
          }
        : nodeSession
          ? {
              mode: 'existing-session' as const,
              session: nodeSession,
              onSelectSession: selectSession,
              onStartNewSession: undefined,
            }
          : {
              mode: 'placeholder' as const,
            })}
      sessions={nodeSessions}
      filesChanged={workspaceSummary?.filesChanged ?? 0}
      linesAdded={workspaceSummary?.linesAdded ?? 0}
      linesRemoved={workspaceSummary?.linesRemoved ?? 0}
      disableViewCode={false}
      showOpenWorkspaceButton
      onScrollToPreviousMessage={handleScrollToPreviousMessage}
      onScrollToBottom={handleScrollToBottom}
      onScrollToUserMessage={handleScrollToUserMessage}
      getActiveTurnPatchKey={handleGetActiveTurnPatchKey}
    />
  );

  return (
    <ExecutionProcessesProvider
      key={`${workspaceId}-${nodeSessionId}`}
      sessionId={nodeSessionId}
    >
      <ApprovalFeedbackProvider>
        <EntriesProvider key={entriesProviderKey}>
          <MessageEditProvider>
            <WorkspacesMain
              workspaceWithSession={
                workspaceWithSession
                  ? { id: workspaceWithSession.id }
                  : undefined
              }
              isLoading={isWorkspaceLoading || isSessionsLoading}
              containerRef={containerRef}
              conversationContent={conversationContent}
              chatBoxContent={chatBoxContent}
              contextBarContent={
                workspaceWithSession ? (
                  <ContextBarContainer containerRef={containerRef} />
                ) : null
              }
              isAtBottom={isAtBottom}
              onAtBottomChange={handleAtBottomChange}
              onScrollToBottom={handleScrollToBottom}
            />
          </MessageEditProvider>
        </EntriesProvider>
      </ApprovalFeedbackProvider>
    </ExecutionProcessesProvider>
  );
}

function WorkflowNodeSessionFallback({
  execution,
  sessionHref,
  workspaceHref,
}: {
  execution: WorkflowNodeExecutionResponse;
  sessionHref: string | null;
  workspaceHref: string | null;
}) {
  return (
    <div
      data-testid="workflow-node-session-panel"
      className="flex min-h-full flex-col gap-base"
    >
      <div className="rounded border border-secondary bg-primary p-half">
        <div className="flex items-start justify-between gap-base">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-high">Agent Session</h3>
            <p
              data-testid="workflow-node-session-id"
              className="mt-1 truncate text-xs text-low"
            >
              Session: {execution.session_id ?? 'Not started'}
            </p>
            <p className="truncate text-xs text-low">
              Process: {execution.execution_process_id ?? 'Not started'}
            </p>
          </div>
          {sessionHref ? (
            <Button asChild size="xs" variant="outline">
              <a href={sessionHref}>Open in workspace</a>
            </Button>
          ) : workspaceHref ? (
            <Button asChild size="xs" variant="outline">
              <a href={workspaceHref}>Open workspace</a>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="rounded border border-secondary bg-primary p-half">
        <h3 className="text-xs font-semibold uppercase text-low">
          Conversation
        </h3>
        <pre className="mt-half whitespace-pre-wrap text-xs text-high">
          {execution.output_text || 'No agent response has been captured yet.'}
        </pre>
      </div>

      <div className="rounded border border-secondary bg-primary p-half">
        <h3 className="text-xs font-semibold uppercase text-low">
          Node Prompt
        </h3>
        <pre className="mt-half whitespace-pre-wrap text-xs text-high">
          {execution.input_text || 'No prompt has been captured yet.'}
        </pre>
      </div>

      {execution.error_text ? (
        <div className="rounded border border-error/50 bg-error/10 p-half">
          <h3 className="text-xs font-semibold uppercase text-error">Error</h3>
          <pre className="mt-half whitespace-pre-wrap text-xs text-error">
            {execution.error_text}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
