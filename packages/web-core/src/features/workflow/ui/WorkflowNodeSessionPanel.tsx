import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ExecutorConfig,
  WorkflowNodeExecutionResponse,
} from 'shared/types';
import {
  AlertCircle,
  Clock,
  ExternalLink,
  Play,
  Settings2,
} from 'lucide-react';
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
import { cn } from '@/shared/lib/utils';
import type { WorkflowNodeData } from '../model/workflowGraph';
import { getWorkflowAgentDisplay } from '../model/workflowAgentDisplay';
import { coerceWorkflowNodeExecutorConfig } from '../model/workflowAgentNodeDraft';
import {
  formatWorkflowDuration,
  getNodeStatusTone,
  type StatusTone,
} from '../model/workflowRunView';
import { workflowNodeStatusKey } from './workflowI18n';

interface WorkflowNodeSessionPanelProps {
  execution: WorkflowNodeExecutionResponse;
  workspaceId: string | null;
  sessionHref: string | null;
  workspaceHref: string | null;
  nodeTitle?: string;
  nodeData?: WorkflowNodeData | null;
  statusLabel?: string | null;
  hideHeader?: boolean;
  onEditConfig?: () => void;
  editConfigDisabled?: boolean;
  onRunStep?: () => void;
  runStepDisabled?: boolean;
  runStepTitle?: string;
}

interface WorkflowNodeSessionHeaderProps {
  execution: WorkflowNodeExecutionResponse;
  sessionHref: string | null;
  workspaceHref: string | null;
  nodeTitle?: string;
  nodeData?: WorkflowNodeData | null;
  statusLabel?: string | null;
  onEditConfig?: () => void;
  editConfigDisabled?: boolean;
  onRunStep?: () => void;
  runStepDisabled?: boolean;
  runStepTitle?: string;
}

const cockpitToneClassMap: Record<StatusTone, string> = {
  neutral: 'border-secondary bg-primary/60 text-low',
  active: 'border-brand/30 bg-brand/10 text-brand',
  success: 'border-success/35 bg-success/10 text-success',
  danger: 'border-error/45 bg-error/10 text-error',
  warning: 'border-warning/40 bg-warning/10 text-warning',
};

const cockpitDotClassMap: Record<StatusTone, string> = {
  neutral: 'bg-low',
  active: 'bg-brand',
  success: 'bg-success',
  danger: 'bg-error',
  warning: 'bg-warning',
};

export function WorkflowNodeSessionPanel({
  execution,
  workspaceId,
  sessionHref,
  workspaceHref,
  nodeTitle,
  nodeData,
  statusLabel,
  hideHeader = false,
  onEditConfig,
  editConfigDisabled,
  onRunStep,
  runStepDisabled,
  runStepTitle,
}: WorkflowNodeSessionPanelProps) {
  const nodeSessionId = execution.session_id;
  const preferredExecutorConfig = useMemo(
    () => coerceWorkflowNodeExecutorConfig(nodeData?.executor_config),
    [nodeData?.executor_config]
  );

  if (!workspaceId || !nodeSessionId) {
    return (
      <WorkflowNodeSessionFallback
        execution={execution}
        sessionHref={sessionHref}
        workspaceHref={workspaceHref}
        nodeTitle={nodeTitle}
        nodeData={nodeData}
        statusLabel={statusLabel}
        hideHeader={hideHeader}
        onEditConfig={onEditConfig}
        editConfigDisabled={editConfigDisabled}
        onRunStep={onRunStep}
        runStepDisabled={runStepDisabled}
        runStepTitle={runStepTitle}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {hideHeader ? null : (
        <WorkflowNodeSessionHeader
          execution={execution}
          sessionHref={sessionHref}
          workspaceHref={workspaceHref}
          nodeTitle={nodeTitle}
          nodeData={nodeData}
          statusLabel={statusLabel}
          onEditConfig={onEditConfig}
          editConfigDisabled={editConfigDisabled}
          onRunStep={onRunStep}
          runStepDisabled={runStepDisabled}
          runStepTitle={runStepTitle}
        />
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <WorkflowNodeEmbeddedSession
          execution={execution}
          nodeSessionId={nodeSessionId}
          sessionHref={sessionHref}
          workspaceId={workspaceId}
          workspaceHref={workspaceHref}
          preferredExecutorConfig={preferredExecutorConfig}
        />
      </div>
    </div>
  );
}

function WorkflowNodeSessionHeader({
  execution,
  sessionHref,
  workspaceHref,
  nodeTitle,
  nodeData,
  statusLabel,
  onEditConfig,
  editConfigDisabled,
  onRunStep,
  runStepDisabled,
  runStepTitle,
}: WorkflowNodeSessionHeaderProps) {
  const { t } = useTranslation('common');
  const agentDisplay = getWorkflowAgentDisplay(nodeData ?? {});
  const title =
    nodeTitle?.trim() ||
    (execution.node_type === 'agent'
      ? t('workflow.nodeSession.agentStepSession')
      : t('workflow.nodeSession.nodeSession'));
  const sessionLabel = execution.session_id
    ? t('workflow.canvas.sessionReady')
    : t('workflow.nodeSession.sessionNotStarted');
  const statusText =
    statusLabel ||
    t(`workflow.nodeStatus.${workflowNodeStatusKey(execution.status)}`);
  const statusTone = getNodeStatusTone(execution.status);
  const canRunStep = Boolean(onRunStep) && !runStepDisabled;
  const canEditConfig = Boolean(onEditConfig) && !editConfigDisabled;
  const openHref = sessionHref || workspaceHref;

  return (
    <div className="shrink-0 border-b border-secondary bg-panel/95 px-base py-base">
      <div className="flex items-start justify-between gap-base">
        <div className="min-w-0 space-y-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-normal text-low">
              {t('workflow.nodeSession.cockpit')}
            </p>
            <h2 className="mt-1 truncate text-sm font-semibold text-high">
              {title}
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <CockpitChip tone="active">{agentDisplay.agentLabel}</CockpitChip>
            <CockpitChip>{agentDisplay.modelLabel}</CockpitChip>
            {agentDisplay.reasoningLabel ? (
              <CockpitChip>{agentDisplay.reasoningLabel}</CockpitChip>
            ) : null}
            <CockpitChip tone={statusTone}>
              <span
                className={cn(
                  'mr-1.5 inline-block h-1.5 w-1.5 rounded-full',
                  cockpitDotClassMap[statusTone]
                )}
              />
              {statusText}
            </CockpitChip>
            <CockpitChip>{sessionLabel}</CockpitChip>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap justify-end gap-half">
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!canRunStep}
            title={
              canRunStep
                ? runStepTitle
                : (runStepTitle ?? t('workflow.canvas.runStepUnavailable'))
            }
            onClick={onRunStep}
            className="gap-1.5"
          >
            <Play className="h-3.5 w-3.5" />
            {t('workflow.nodeSession.runThisStep')}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={!canEditConfig}
            onClick={onEditConfig}
            className="gap-1.5"
          >
            <Settings2 className="h-3.5 w-3.5" />
            {t('workflow.nodeSession.editConfig')}
          </Button>
          {openHref ? (
            <Button asChild size="xs" variant="outline" className="gap-1.5">
              <a href={openHref}>
                <ExternalLink className="h-3.5 w-3.5" />
                {t('workflow.nodeSession.openWorkspace')}
              </a>
            </Button>
          ) : (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled
              className="gap-1.5"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('workflow.nodeSession.openWorkspace')}
            </Button>
          )}
        </div>
      </div>

      <WorkflowNodeRunSummary execution={execution} />
      <WorkflowNodeTechnicalDetails execution={execution} />
    </div>
  );
}

function CockpitChip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: StatusTone;
}) {
  return (
    <span
      className={cn(
        'inline-flex max-w-[220px] items-center truncate rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none',
        cockpitToneClassMap[tone]
      )}
    >
      {children}
    </span>
  );
}

function formatWorkflowTimestamp(value: string | null): string | null {
  if (!value) return null;
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return time.toLocaleString();
}

function WorkflowNodeRunSummary({
  execution,
}: {
  execution: WorkflowNodeExecutionResponse;
}) {
  const { t } = useTranslation('common');
  const statusTone = getNodeStatusTone(execution.status);
  const startedLabel = formatWorkflowTimestamp(execution.started_at);
  const finishedLabel = formatWorkflowTimestamp(execution.finished_at);
  const durationLabel = formatWorkflowDuration(
    execution.started_at,
    execution.finished_at
  );
  const hasError = execution.status === 'failed' || !!execution.error_text;

  const summary = (() => {
    if (hasError) {
      return {
        title: t('workflow.nodeSession.lastRunFailed'),
        detail:
          execution.error_text ||
          execution.output_text ||
          t('workflow.nodeSession.failedWithoutMessage'),
      };
    }
    if (execution.status === 'running') {
      return {
        title: t('workflow.nodeSession.runningNow'),
        detail: startedLabel
          ? t('workflow.nodeSession.startedDuration', {
              started: startedLabel,
              duration: durationLabel,
            })
          : t('workflow.nodeSession.agentWorking'),
      };
    }
    if (
      execution.status === 'awaiting_human' ||
      execution.status === 'awaiting_arena'
    ) {
      return {
        title: t(
          `workflow.nodeStatus.${workflowNodeStatusKey(execution.status)}`
        ),
        detail:
          execution.output_text || t('workflow.nodeSession.waitingForDecision'),
      };
    }
    if (execution.status === 'succeeded') {
      return {
        title: t('workflow.nodeSession.lastRunSucceeded'),
        detail: finishedLabel
          ? t('workflow.nodeSession.finishedDuration', {
              finished: finishedLabel,
              duration: durationLabel,
            })
          : durationLabel,
      };
    }
    return {
      title: t('workflow.nodeSession.notStartedYet'),
      detail: execution.session_id
        ? t('workflow.nodeSession.readyForConversation')
        : t('workflow.nodeSession.noSessionYet'),
    };
  })();

  return (
    <div
      className={cn(
        'mt-base rounded border p-half text-xs',
        cockpitToneClassMap[hasError ? 'danger' : statusTone]
      )}
      role={hasError ? 'alert' : undefined}
    >
      <div className="flex items-center gap-half font-semibold text-high">
        {hasError ? (
          <AlertCircle className="h-3.5 w-3.5 text-error" />
        ) : (
          <Clock className="h-3.5 w-3.5 text-low" />
        )}
        <span>{summary.title}</span>
      </div>
      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-low">
        {summary.detail}
      </p>
    </div>
  );
}

function WorkflowNodeTechnicalDetails({
  execution,
}: {
  execution: WorkflowNodeExecutionResponse;
}) {
  const { t } = useTranslation('common');
  return (
    <details className="mt-half rounded border border-secondary bg-primary/50 px-half py-1 text-xs text-low">
      <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-normal text-low">
        {t('workflow.nodeSession.technicalDetails')}
      </summary>
      <div className="mt-half grid gap-half">
        <TechnicalDetailRow label={t('workflow.runCanvas.nodeId')}>
          {execution.node_id}
        </TechnicalDetailRow>
        <TechnicalDetailRow label={t('workflow.runCanvas.executionId')}>
          {execution.id}
        </TechnicalDetailRow>
        <TechnicalDetailRow label={t('workflow.nodeSession.sessionId')}>
          {execution.session_id ?? t('workflow.dashboard.notStarted')}
        </TechnicalDetailRow>
        <TechnicalDetailRow label={t('workflow.nodeSession.processId')}>
          {execution.execution_process_id ?? t('workflow.dashboard.notStarted')}
        </TechnicalDetailRow>
      </div>
    </details>
  );
}

function TechnicalDetailRow({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="grid grid-cols-[84px_minmax(0,1fr)] gap-half">
      <span className="text-low">{label}</span>
      <span className="break-all text-high">{children}</span>
    </div>
  );
}

function WorkflowNodeEmbeddedSession({
  execution,
  nodeSessionId,
  sessionHref,
  workspaceId,
  workspaceHref,
  preferredExecutorConfig,
}: {
  execution: WorkflowNodeExecutionResponse;
  nodeSessionId: string;
  sessionHref: string | null;
  workspaceId: string;
  workspaceHref: string | null;
  preferredExecutorConfig: ExecutorConfig | null;
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
      preferredExecutorConfig={preferredExecutorConfig}
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
  nodeTitle,
  nodeData,
  statusLabel,
  hideHeader,
  onEditConfig,
  editConfigDisabled,
  onRunStep,
  runStepDisabled,
  runStepTitle,
}: Omit<WorkflowNodeSessionPanelProps, 'workspaceId'>) {
  const { t } = useTranslation('common');
  return (
    <div
      data-testid="workflow-node-session-panel"
      className="flex min-h-full flex-col"
    >
      {hideHeader ? null : (
        <WorkflowNodeSessionHeader
          execution={execution}
          sessionHref={sessionHref}
          workspaceHref={workspaceHref}
          nodeTitle={nodeTitle}
          nodeData={nodeData}
          statusLabel={statusLabel}
          onEditConfig={onEditConfig}
          editConfigDisabled={editConfigDisabled}
          onRunStep={onRunStep}
          runStepDisabled={runStepDisabled}
          runStepTitle={runStepTitle}
        />
      )}

      <div className="flex flex-1 flex-col gap-base overflow-y-auto p-base">
        <div className="rounded border border-secondary bg-primary p-half">
          <h3 className="text-xs font-semibold uppercase text-low">
            {t('workflow.nodeSession.conversation')}
          </h3>
          <p data-testid="workflow-node-session-id" className="sr-only">
            {t('workflow.nodeSession.session', {
              id: execution.session_id ?? t('workflow.dashboard.notStarted'),
            })}
          </p>
          <pre className="mt-half whitespace-pre-wrap text-xs text-high">
            {execution.output_text || t('workflow.nodeSession.noAgentResponse')}
          </pre>
        </div>

        <div className="rounded border border-secondary bg-primary p-half">
          <h3 className="text-xs font-semibold uppercase text-low">
            {t('workflow.nodeSession.nodePrompt')}
          </h3>
          <pre className="mt-half whitespace-pre-wrap text-xs text-high">
            {execution.input_text || t('workflow.nodeSession.noPrompt')}
          </pre>
        </div>

        {execution.error_text ? (
          <div className="rounded border border-error/50 bg-error/10 p-half">
            <h3 className="text-xs font-semibold uppercase text-error">
              {t('workflow.dashboard.error')}
            </h3>
            <pre className="mt-half whitespace-pre-wrap text-xs text-error">
              {execution.error_text}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
