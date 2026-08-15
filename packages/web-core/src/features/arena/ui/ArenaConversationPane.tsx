import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Session } from 'shared/types';
import { Button } from '@vibe/ui/components/Button';
import { ConversationList } from '@/features/workspace-chat/ui/ConversationListContainer';
import type { ConversationListHandle } from '@/features/workspace-chat/ui/ConversationListContainer';
import { ApprovalFeedbackProvider } from '@/features/workspace-chat/model/contexts/ApprovalFeedbackContext';
import { EntriesProvider } from '@/features/workspace-chat/model/contexts/EntriesContext';
import { MessageEditProvider } from '@/features/workspace-chat/model/contexts/MessageEditContext';
import { RetryUiProvider } from '@/features/workspace-chat/model/contexts/RetryUiContext';
import { SessionChatBoxContainer } from '@/features/workspace-chat/ui/SessionChatBoxContainer';
import { ExecutionProcessesProvider } from '@/shared/providers/ExecutionProcessesProvider';
import { useDiffSummary } from '@/shared/hooks/useDiffSummary';
import { useWorkspaceRecord } from '@/shared/hooks/useWorkspaceRecord';
import { useWorkspaceRepo } from '@/shared/hooks/useWorkspaceRepo';
import { useWorkspaceSessions } from '@/shared/hooks/useWorkspaceSessions';
import { createWorkspaceWithSession } from '@/shared/types/attempt';
import type {
  ArenaGroupResponse,
  ArenaWorkspaceSummary,
} from '@/shared/lib/arenaApi';

interface ArenaConversationPaneProps {
  group: ArenaGroupResponse;
  workspace: ArenaWorkspaceSummary;
  detailHref?: string;
}

const STATUS_BADGE_CLASS: Record<
  ArenaWorkspaceSummary['arena_status'],
  string
> = {
  active: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  promoted: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  archived: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
};

function ChatBoxWithDiffSummary({
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
  workspaceId: string;
  isNewSessionMode: boolean;
  sessions: Session[];
  onSelectSession: (sessionId: string) => void;
  onStartNewSession: () => void;
  onScrollToPreviousMessage: () => void;
  onScrollToBottom: (behavior?: 'auto' | 'smooth') => void;
  onScrollToUserMessage: (patchKey: string) => void;
  getActiveTurnPatchKey: () => string | null;
}) {
  const diffSummary = useDiffSummary(workspaceId);

  return (
    <SessionChatBoxContainer
      {...(isNewSessionMode
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
      filesChanged={diffSummary.fileCount}
      linesAdded={diffSummary.added}
      linesRemoved={diffSummary.deleted}
      disableViewCode
      showOpenWorkspaceButton
      onScrollToPreviousMessage={onScrollToPreviousMessage}
      onScrollToBottom={onScrollToBottom}
      onScrollToUserMessage={onScrollToUserMessage}
      getActiveTurnPatchKey={getActiveTurnPatchKey}
    />
  );
}

export function ArenaConversationPane({
  group,
  workspace,
  detailHref,
}: ArenaConversationPaneProps) {
  const { t } = useTranslation('common');
  const conversationListRef = useRef<ConversationListHandle>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const { data: workspaceRecord, isLoading: workspaceLoading } =
    useWorkspaceRecord(workspace.workspace_id, {
      enabled: !!workspace.workspace_id,
    });
  const { repos } = useWorkspaceRepo(workspace.workspace_id, {
    enabled: !!workspace.workspace_id,
  });
  const {
    sessions,
    selectedSession,
    selectedSessionId,
    selectSession,
    isLoading: sessionsLoading,
    isNewSessionMode,
    startNewSession,
  } = useWorkspaceSessions(workspace.workspace_id, {
    enabled: !!workspace.workspace_id,
  });

  const attempt = useMemo(() => {
    if (!workspaceRecord) return undefined;
    return createWorkspaceWithSession(workspaceRecord, selectedSession);
  }, [workspaceRecord, selectedSession]);

  const handleScrollToBottom = useCallback(
    (behavior: 'auto' | 'smooth' = 'smooth') => {
      conversationListRef.current?.scrollToBottom(behavior);
    },
    []
  );

  const handleScrollToPreviousMessage = useCallback(() => {
    conversationListRef.current?.scrollToPreviousUserMessage();
  }, []);

  const handleScrollToUserMessage = useCallback((patchKey: string) => {
    conversationListRef.current?.scrollToEntryByPatchKey(patchKey);
  }, []);

  const handleGetActiveTurnPatchKey = useCallback(() => {
    return conversationListRef.current?.getVisibleUserMessagePatchKey() ?? null;
  }, []);

  const badgeClassName = STATUS_BADGE_CLASS[workspace.arena_status];
  const isSynthesis = workspace.purpose === 'synthesis';
  const entriesProviderKey = `${workspace.workspace_id}:${selectedSessionId ?? 'new'}`;
  const isLoading = workspaceLoading || sessionsLoading || !attempt;

  return (
    <ExecutionProcessesProvider
      key={entriesProviderKey}
      sessionId={selectedSessionId}
    >
      <ApprovalFeedbackProvider>
        <EntriesProvider key={entriesProviderKey} sessionId={selectedSessionId}>
          <MessageEditProvider>
            <section className="flex min-h-0 min-w-[420px] flex-1 flex-col overflow-hidden rounded border border-zinc-200 bg-primary dark:border-zinc-800">
              <div className="border-b border-zinc-200 px-base py-half dark:border-zinc-800">
                <div className="flex items-start justify-between gap-base">
                  <div className="min-w-0">
                    <div className="flex items-center gap-half text-sm font-medium">
                      <span className="truncate">
                        {isSynthesis
                          ? t('arena.synthesis.decisionMemo')
                          : workspace.executor ||
                            workspace.name ||
                            t('arena.workspace.agent')}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeClassName}`}
                      >
                        {t(`arena.status.${workspace.arena_status}`)}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-xs text-low">
                      {isSynthesis
                        ? `${workspace.name || t('arena.synthesis.defaultWorkspaceName')} / ${workspace.branch}`
                        : `${workspace.variant || group.mode} / ${workspace.branch}`}
                    </div>
                  </div>
                  {detailHref ? (
                    <Button asChild size="xs" variant="outline">
                      <a href={detailHref}>{t('arena.actions.open')}</a>
                    </Button>
                  ) : null}
                </div>
              </div>

              {isLoading ? (
                <div className="flex flex-1 items-center justify-center text-sm text-low">
                  {t('arena.workspace.loadingConversation')}
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <RetryUiProvider workspaceId={workspace.workspace_id}>
                      <ConversationList
                        key={entriesProviderKey}
                        ref={conversationListRef}
                        attempt={attempt}
                        repos={repos}
                        onAtBottomChange={setIsAtBottom}
                        sessionScopeId={selectedSessionId}
                      />
                    </RetryUiProvider>
                  </div>
                  {!isAtBottom ? (
                    <div className="flex justify-end border-t border-zinc-200 px-half py-half dark:border-zinc-800">
                      <Button
                        size="xs"
                        variant="ghost"
                        type="button"
                        onClick={() => handleScrollToBottom('auto')}
                      >
                        {t('arena.actions.bottom')}
                      </Button>
                    </div>
                  ) : null}
                  <div
                    data-chatbox-container="true"
                    className="border-t border-zinc-200 dark:border-zinc-800"
                  >
                    <ChatBoxWithDiffSummary
                      session={selectedSession}
                      workspaceId={workspace.workspace_id}
                      isNewSessionMode={isNewSessionMode}
                      sessions={sessions}
                      onSelectSession={selectSession}
                      onStartNewSession={startNewSession}
                      onScrollToPreviousMessage={handleScrollToPreviousMessage}
                      onScrollToBottom={handleScrollToBottom}
                      onScrollToUserMessage={handleScrollToUserMessage}
                      getActiveTurnPatchKey={handleGetActiveTurnPatchKey}
                    />
                  </div>
                </div>
              )}
            </section>
          </MessageEditProvider>
        </EntriesProvider>
      </ApprovalFeedbackProvider>
    </ExecutionProcessesProvider>
  );
}
