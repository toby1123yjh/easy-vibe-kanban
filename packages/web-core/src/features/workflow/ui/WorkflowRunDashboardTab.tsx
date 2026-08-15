import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkflowRunResponse } from 'shared/types';
import { useWorkflowTemplate } from '@/shared/hooks/useWorkflowTemplates';
import { useWorkflowRunMutations } from '@/shared/hooks/useWorkflowRun';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import {
  buildAgentSessionRows,
  buildWorkspaceSessionHref,
  buildWorkflowRunDashboardSummary,
  formatWorkflowDuration,
  getNodeStatusTone,
} from '../model/workflowRunView';
import {
  getDefaultWorkflowRuntimeNodeId,
  getWorkflowNodeActionGate,
  getWorkflowNodeExecutionForWork,
  getWorkflowNodeWork,
  getWorkflowRuntimeView,
} from '../model/workflowRuntimeView';
import {
  getConditionRouterHumanPrompt,
  getConditionRouterReason,
  parseConditionRouterOutput,
} from '../model/workflowConditionRouterOutput';
import {
  Square,
  RefreshCcw,
  Check,
  X,
  Clock,
  ExternalLink,
  Code,
  Files,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { WorkflowArenaWinnerPanel } from './WorkflowArenaWinnerPanel';
import { WorkflowAgentSessionsList } from './WorkflowAgentSessionsList';
import {
  WorkspaceFilesInlineInspector,
  useWorkspaceFilePreviewState,
} from '@/features/workspace-files';

export interface WorkflowRunDashboardTabProps {
  projectId: string;
  run: WorkflowRunResponse;
}

function getDefaultSelectedNodeId(run: WorkflowRunResponse): string | null {
  return getDefaultWorkflowRuntimeNodeId(getWorkflowRuntimeView(run));
}

function getReadableWorkflowNodeOutput(
  nodeType: string,
  outputText: string | null
): string | null {
  if (nodeType !== 'condition') return outputText;

  const routerOutput = parseConditionRouterOutput(outputText);
  return (
    getConditionRouterHumanPrompt(routerOutput) ??
    getConditionRouterReason(routerOutput) ??
    outputText
  );
}

export function WorkflowRunDashboardTab({
  projectId,
  run,
}: WorkflowRunDashboardTabProps) {
  const { t } = useTranslation('common');
  const { data: template } = useWorkflowTemplate(run.workflow_id);
  const mutations = useWorkflowRunMutations();
  const appNav = useAppNavigation();
  const runtimeView = getWorkflowRuntimeView(run);
  const summary = buildWorkflowRunDashboardSummary(run, runtimeView);
  const [actionError, setActionError] = useState<string | null>(null);
  const formatDuration = (start: string | null, end: string | null) => {
    const label = formatWorkflowDuration(start, end);
    return label === 'Not started' ? t('workflow.dashboard.notStarted') : label;
  };

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    getDefaultSelectedNodeId(run)
  );
  const [showFilesInspector, setShowFilesInspector] = useState(false);
  const { target, openTarget, clearTarget } = useWorkspaceFilePreviewState();

  useEffect(() => {
    if (
      selectedNodeId &&
      runtimeView.node_work.some((work) => work.node_id === selectedNodeId)
    ) {
      return;
    }

    setSelectedNodeId(getDefaultSelectedNodeId(run));
  }, [runtimeView, selectedNodeId]);

  const selectedNodeWork = getWorkflowNodeWork(runtimeView, selectedNodeId);
  const selectedNode = getWorkflowNodeExecutionForWork(run, selectedNodeWork);
  const selectedNodeActionGate = getWorkflowNodeActionGate(selectedNodeWork);
  const selectedNodeOutput = selectedNode
    ? getReadableWorkflowNodeOutput(
        selectedNode.node_type,
        selectedNode.output_text
      )
    : null;
  const selectedAgentSessionRows = buildAgentSessionRows(run, selectedNodeId);
  const workflowWorkspaceHref = run.workspace_id
    ? `/projects/${projectId}/issues/${run.issue_id}/workspaces/${run.workspace_id}`
    : null;
  const handleOpenWorkflowWorkspace = useCallback(() => {
    if (!run.workspace_id) return;
    appNav.goToProjectIssueWorkspace(projectId, run.issue_id, run.workspace_id);
  }, [appNav, projectId, run.issue_id, run.workspace_id]);

  const handleCancelRun = async () => {
    if (!run.runtime_view || runtimeView.authority !== 'current') {
      setActionError(
        t('workflow.runCanvas.actionUnavailable', {
          defaultValue:
            'Action unavailable while runtime projection is unavailable.',
        })
      );
      return;
    }
    setActionError(null);
    try {
      await mutations.cancelRun(run.id);
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : t('workflow.dashboard.cancelFailed')
      );
    }
  };

  const handleRetryNode = async (nodeId: string) => {
    const work = getWorkflowNodeWork(runtimeView, nodeId);
    if (!getWorkflowNodeActionGate(work).canRetry) {
      setActionError(
        t('workflow.runCanvas.actionUnavailable', {
          defaultValue:
            'Action unavailable while runtime projection is unavailable.',
        })
      );
      return;
    }
    setActionError(null);
    try {
      await mutations.retryNode({ runId: run.id, nodeId });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : t('workflow.dashboard.retryFailed')
      );
    }
  };

  const handleApproveNode = async (nodeId: string) => {
    if (
      !getWorkflowNodeActionGate(getWorkflowNodeWork(runtimeView, nodeId))
        .canApprove
    ) {
      setActionError(
        t('workflow.runCanvas.actionUnavailable', {
          defaultValue:
            'Action unavailable while runtime projection is unavailable.',
        })
      );
      return;
    }
    setActionError(null);
    try {
      await mutations.approveNode({
        runId: run.id,
        nodeId,
        payload: {},
      });
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : t('workflow.dashboard.approveFailed')
      );
    }
  };

  const handleRejectNode = async (nodeId: string) => {
    if (
      !getWorkflowNodeActionGate(getWorkflowNodeWork(runtimeView, nodeId))
        .canReject
    ) {
      setActionError(
        t('workflow.runCanvas.actionUnavailable', {
          defaultValue:
            'Action unavailable while runtime projection is unavailable.',
        })
      );
      return;
    }
    setActionError(null);
    try {
      await mutations.rejectNode({
        runId: run.id,
        nodeId,
        payload: {},
      });
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : t('workflow.dashboard.rejectFailed')
      );
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto sm:flex-row">
      <div className="flex-1 space-y-4 p-base sm:w-2/3">
        {/* Header section */}
        <section className="rounded border border-secondary bg-panel p-4">
          <h2 className="mb-2 text-sm font-semibold text-high">
            {t('workflow.dashboard.runDetails')}
          </h2>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-low">
                {t('workflow.dashboard.issueId')}:
              </span>
              <span className="ml-2 text-high">{run.issue_id}</span>
            </div>
            <div>
              <span className="text-low">
                {t('workflow.dashboard.workflow')}:
              </span>
              <span className="ml-2 text-high">
                {template?.name || run.workflow_id}
              </span>
            </div>
            <div>
              <span className="text-low">{t('workflow.dashboard.runId')}:</span>
              <span className="ml-2 text-high">{run.id}</span>
            </div>
            <div>
              <span className="text-low">
                {t('workflow.dashboard.status')}:
              </span>
              <span
                className={cn(
                  'ml-2 font-medium',
                  getNodeStatusToneClass(run.status)
                )}
              >
                {t(`workflow.runStatus.${statusKey(run.status)}`)}
              </span>
            </div>
          </div>
        </section>

        {/* Progress */}
        <section className="rounded border border-secondary bg-panel p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-high">
              {t('workflow.dashboard.progress')}
            </h2>
            {runtimeView.authority === 'current' &&
              (run.status === 'running' ||
                run.status === 'pending' ||
                run.status === 'awaiting_human' ||
                run.status === 'awaiting_arena') && (
                <button
                  className="flex items-center gap-1 rounded bg-secondary px-2 py-1 text-xs text-error hover:opacity-80"
                  onClick={() => void handleCancelRun()}
                  disabled={mutations.isCanceling}
                >
                  <Square className="h-3 w-3" />
                  {t('workflow.dashboard.cancelRun')}
                </button>
              )}
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex-1">
              <div className="mb-1 flex justify-between text-low">
                <span>
                  {t('workflow.dashboard.stepsSucceeded', {
                    completed: summary.completedSteps,
                    total: summary.totalSteps,
                  })}
                </span>
                <span>{summary.progressPercent}%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-primary overflow-hidden">
                <div
                  className="h-full bg-brand transition-all"
                  style={{ width: `${summary.progressPercent}%` }}
                />
              </div>
            </div>
            <div className="text-low">
              <Clock className="inline-block h-3 w-3 mr-1" />
              {formatDuration(run.started_at, run.finished_at)}
            </div>
          </div>
          {summary.failedSteps > 0 ||
          summary.skippedSteps > 0 ||
          summary.waitingSteps > 0 ||
          summary.runningSteps > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-low">
              {summary.runningSteps > 0 ? (
                <span className="rounded border border-brand/30 bg-brand/10 px-2 py-0.5 text-brand">
                  {t('workflow.dashboard.runningCount', {
                    count: summary.runningSteps,
                  })}
                </span>
              ) : null}
              {summary.waitingSteps > 0 ? (
                <span className="rounded border border-warning/30 bg-warning/10 px-2 py-0.5 text-warning">
                  {t('workflow.dashboard.waitingCount', {
                    count: summary.waitingSteps,
                  })}
                </span>
              ) : null}
              {summary.failedSteps > 0 ? (
                <span className="rounded border border-error/30 bg-error/10 px-2 py-0.5 text-error">
                  {t('workflow.dashboard.failedCount', {
                    count: summary.failedSteps,
                  })}
                </span>
              ) : null}
              {summary.skippedSteps > 0 ? (
                <span className="rounded border border-secondary bg-primary px-2 py-0.5 text-low">
                  {t('workflow.dashboard.skippedCount', {
                    count: summary.skippedSteps,
                  })}
                </span>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* Steps Timeline */}
        <section className="rounded border border-secondary bg-panel p-4">
          <h2 className="mb-4 text-sm font-semibold text-high">
            {t('workflow.dashboard.stepsTimeline')}
          </h2>
          <div className="space-y-2">
            {runtimeView.node_work.length === 0 ? (
              <div className="text-xs text-low">
                {t('workflow.dashboard.noStepsExecuted')}
              </div>
            ) : (
              runtimeView.node_work.map((work) => {
                const node = getWorkflowNodeExecutionForWork(run, work);
                if (!node) {
                  return (
                    <div
                      key={`unknown-${work.node_id}-${work.iteration}`}
                      className="rounded border border-warning/30 bg-warning/10 p-2 text-xs text-warning"
                    >
                      {t('workflow.dashboard.runtimeProjectionUnavailable')}
                    </div>
                  );
                }
                const nodeSessionHref = buildWorkspaceSessionHref(
                  workflowWorkspaceHref,
                  node.session_id
                );

                return (
                  <div
                    key={node.id}
                    className={cn(
                      'flex items-center justify-between rounded border p-2 cursor-pointer transition-colors text-xs',
                      selectedNodeId === node.node_id
                        ? 'border-brand bg-secondary'
                        : 'border-secondary bg-primary hover:border-low'
                    )}
                    onClick={() => setSelectedNodeId(node.node_id)}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded-full text-white',
                          getToneBgClass(getNodeStatusTone(node.status))
                        )}
                      >
                        {node.status === 'succeeded' ? (
                          <Check className="h-3 w-3" />
                        ) : node.status === 'failed' ? (
                          <X className="h-3 w-3" />
                        ) : node.status === 'running' ? (
                          <RefreshCcw className="h-3 w-3 animate-spin" />
                        ) : (
                          <Clock className="h-3 w-3" />
                        )}
                      </div>
                      <span className="font-medium text-high">
                        {node.node_id}
                      </span>
                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded bg-primary',
                          getToneTextClass(getNodeStatusTone(node.status))
                        )}
                      >
                        {t(`workflow.nodeStatus.${statusKey(node.status)}`)}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-low">
                      {nodeSessionHref ? (
                        <a
                          href={nodeSessionHref}
                          className="flex items-center gap-1 hover:text-brand"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <ExternalLink className="h-3 w-3" />
                          {t('workflow.dashboard.session')}
                        </a>
                      ) : null}
                      <span>
                        {formatDuration(node.started_at, node.finished_at)}
                      </span>
                      {node.status === 'failed' &&
                        getWorkflowNodeActionGate(work).canRetry && (
                          <button
                            className="rounded p-1 text-high hover:bg-secondary"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleRetryNode(node.node_id);
                            }}
                            disabled={mutations.isRetrying}
                            title={t('workflow.dashboard.retryStep')}
                          >
                            <RefreshCcw className="h-3 w-3" />
                          </button>
                        )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Code / Artifacts */}
        <section className="rounded border border-secondary bg-panel p-4">
          <h2 className="mb-2 text-sm font-semibold text-high">
            {t('workflow.dashboard.codeChanges')}
          </h2>
          {run.workspace_id ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-half">
                <button
                  onClick={handleOpenWorkflowWorkspace}
                  className="inline-flex items-center gap-2 rounded bg-primary px-3 py-2 text-xs font-medium text-brand hover:underline border border-secondary"
                >
                  <Code className="h-4 w-4" />
                  {t('workflow.dashboard.openWorkflowWorkspace')}
                </button>
                <button
                  type="button"
                  onClick={() => setShowFilesInspector((current) => !current)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded bg-primary px-3 py-2 text-xs font-medium border border-secondary',
                    showFilesInspector
                      ? 'text-high'
                      : 'text-brand hover:underline'
                  )}
                  aria-expanded={showFilesInspector}
                >
                  <Files className="h-4 w-4" />
                  {t('workflow.dashboard.inspectFiles')}
                </button>
              </div>
              {showFilesInspector ? (
                <div className="h-[420px] overflow-hidden rounded border border-secondary">
                  <WorkspaceFilesInlineInspector
                    workspaceId={run.workspace_id}
                    target={target}
                    source="workflow"
                    title={t('workflow.dashboard.inspectFiles')}
                    onSelectFile={openTarget}
                    onClearTarget={clearTarget}
                    onClose={() => setShowFilesInspector(false)}
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-xs text-low italic">
              {t('workflow.dashboard.noCodeChanges')}
            </div>
          )}
        </section>
      </div>

      {/* Side Column */}
      <div className="flex-1 space-y-4 border-l border-secondary bg-primary p-base sm:w-1/3 sm:flex-none sm:max-w-md">
        {/* Selected Step Detail */}
        <section className="rounded border border-secondary bg-panel p-4">
          <h2 className="mb-4 text-sm font-semibold text-high">
            {selectedNode
              ? t('workflow.dashboard.selectedStep', {
                  nodeId: selectedNode.node_id,
                })
              : t('workflow.dashboard.selectStep')}
          </h2>
          {!selectedNode ? (
            <div className="text-xs text-low">
              {t('workflow.dashboard.noStepSelected')}
            </div>
          ) : (
            <div className="space-y-4 text-xs">
              {actionError ? (
                <p className="text-xs text-error" role="alert">
                  {actionError}
                </p>
              ) : null}

              {selectedNode.node_type === 'agent' ? (
                <WorkflowAgentSessionsList
                  rows={selectedAgentSessionRows}
                  workspaceHref={workflowWorkspaceHref}
                />
              ) : null}

              <div>
                <h3 className="font-medium text-low mb-1">
                  {t('workflow.dashboard.input')}
                </h3>
                <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-primary p-2 text-high border border-secondary font-mono text-[10px]">
                  {selectedNode.input_text || (
                    <span className="italic text-low">
                      {t('workflow.dashboard.noInput')}
                    </span>
                  )}
                </pre>
              </div>

              <div>
                <h3 className="font-medium text-low mb-1">
                  {t('workflow.dashboard.output')}
                </h3>
                <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-primary p-2 text-high border border-secondary font-mono text-[10px]">
                  {selectedNodeOutput || (
                    <span className="italic text-low">
                      {t('workflow.dashboard.noOutput')}
                    </span>
                  )}
                </pre>
              </div>

              {selectedNode.error_text && (
                <div>
                  <h3 className="font-medium text-error mb-1">
                    {t('workflow.dashboard.error')}
                  </h3>
                  <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-primary p-2 text-error border border-error/50 bg-error/10 font-mono text-[10px]">
                    {selectedNode.error_text}
                  </pre>
                </div>
              )}

              {selectedNodeActionGate.canApprove &&
                selectedNodeActionGate.canReject && (
                  <div className="flex gap-2 pt-2">
                    <button
                      className="flex-1 rounded bg-success px-3 py-1.5 text-white font-medium hover:opacity-90 disabled:opacity-50"
                      onClick={() =>
                        void handleApproveNode(selectedNode.node_id)
                      }
                      disabled={mutations.isApproving || mutations.isRejecting}
                    >
                      {t('workflow.dashboard.approve')}
                    </button>
                    <button
                      className="flex-1 rounded bg-error px-3 py-1.5 text-white font-medium hover:opacity-90 disabled:opacity-50"
                      onClick={() =>
                        void handleRejectNode(selectedNode.node_id)
                      }
                      disabled={mutations.isApproving || mutations.isRejecting}
                    >
                      {t('workflow.dashboard.reject')}
                    </button>
                  </div>
                )}

              {selectedNodeActionGate.canSelectArenaWinner && (
                <WorkflowArenaWinnerPanel
                  arenaGroupId={selectedNode.arena_group_id}
                  issueId={run.issue_id}
                  nodeId={selectedNode.node_id}
                  projectId={projectId}
                  runId={run.id}
                />
              )}
            </div>
          )}
        </section>

        {/* Decisions Made */}
        <section className="rounded border border-secondary bg-panel p-4">
          <h2 className="mb-3 text-sm font-semibold text-high">
            {t('workflow.dashboard.decisionsMade')}
          </h2>
          <div className="space-y-3 text-xs">
            {runtimeView.node_work.filter(
              (work) =>
                work.node_type === 'condition' ||
                work.node_type === 'human_gate' ||
                work.node_type === 'arena'
            ).length === 0 ? (
              <div className="text-low italic">
                {t('workflow.dashboard.noDecisionNodes')}
              </div>
            ) : (
              runtimeView.node_work
                .filter(
                  (work) =>
                    work.node_type === 'condition' ||
                    work.node_type === 'human_gate' ||
                    work.node_type === 'arena'
                )
                .map((work) => {
                  const node = getWorkflowNodeExecutionForWork(run, work);
                  if (!node) return null;
                  return (
                    <div
                      key={`dec-${node.id}`}
                      className="border-l-2 border-brand pl-3"
                    >
                      <div className="font-medium text-high">
                        {node.node_id}{' '}
                        <span className="text-low font-normal">
                          ({node.node_type})
                        </span>
                      </div>
                      {node.node_type === 'condition' && (
                        <div className="text-low mt-1">
                          {t('workflow.dashboard.conditionMet')}:{' '}
                          <span className="text-high">
                            {getReadableWorkflowNodeOutput(
                              node.node_type,
                              node.output_text
                            ) || t('workflow.dashboard.none')}
                          </span>
                        </div>
                      )}
                      {node.node_type === 'human_gate' && (
                        <div className="text-low mt-1">
                          {t('workflow.dashboard.status')}:{' '}
                          <span
                            className={cn(
                              'font-medium',
                              getToneTextClass(getNodeStatusTone(node.status))
                            )}
                          >
                            {t(`workflow.nodeStatus.${statusKey(node.status)}`)}
                          </span>
                        </div>
                      )}
                      {node.node_type === 'arena' && (
                        <div className="text-low mt-1 space-y-1">
                          <div>
                            {t('workflow.dashboard.status')}:{' '}
                            <span className="text-high">
                              {t(
                                `workflow.nodeStatus.${statusKey(node.status)}`
                              )}
                            </span>
                          </div>
                          {node.arena_group_id && (
                            <div>
                              {t('workflow.dashboard.arenaGroup')}:{' '}
                              <a
                                className="inline-flex items-center gap-1 text-brand hover:underline"
                                href={`/projects/${projectId}/issues/${run.issue_id}/arena/${node.arena_group_id}`}
                              >
                                {node.arena_group_id}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            </div>
                          )}
                          {node.status === 'awaiting_arena' && (
                            <button
                              type="button"
                              className="text-brand hover:underline"
                              onClick={() => setSelectedNodeId(node.node_id)}
                            >
                              {t('workflow.dashboard.pickWinner')}
                            </button>
                          )}
                          {node.output_text && (
                            <div>
                              {t('workflow.dashboard.winner')}:{' '}
                              <span className="text-success">
                                {node.output_text}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
                .filter((item): item is JSX.Element => Boolean(item))
            )}
          </div>
        </section>

        {/* Agent Contribution */}
        <section className="rounded border border-secondary bg-panel p-4">
          <h2 className="mb-3 text-sm font-semibold text-high">
            {t('workflow.dashboard.agentContribution')}
          </h2>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-low">
                {t('workflow.dashboard.totalTokens')}:
              </span>
              <span className="text-high font-medium">
                {summary.totalTokens > 0
                  ? summary.totalTokens.toLocaleString()
                  : t('workflow.dashboard.notAvailable')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-low">
                {t('workflow.dashboard.estimatedCost')}:
              </span>
              <span className="text-high font-medium">
                {summary.totalCostEstimate > 0
                  ? `$${summary.totalCostEstimate.toFixed(4)}`
                  : t('workflow.dashboard.notAvailable')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-low">
                {t('workflow.dashboard.agentSteps')}:
              </span>
              <span className="text-high font-medium">
                {
                  runtimeView.node_work.filter(
                    (work) => work.node_type === 'agent'
                  ).length
                }
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-low">
                {t('workflow.dashboard.controlSteps')}:
              </span>
              <span className="text-high font-medium">
                {
                  runtimeView.node_work.filter(
                    (work) => work.node_type !== 'agent'
                  ).length
                }
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// Helpers for styling
function statusKey(status: string): string {
  switch (status) {
    case 'awaiting_human':
      return 'awaitingHuman';
    case 'awaiting_arena':
      return 'awaitingArena';
    default:
      return status;
  }
}

function getToneTextClass(tone: string) {
  switch (tone) {
    case 'success':
      return 'text-success';
    case 'danger':
      return 'text-error';
    case 'warning':
      return 'text-warning';
    case 'active':
      return 'text-brand';
    default:
      return 'text-low';
  }
}

function getToneBgClass(tone: string) {
  switch (tone) {
    case 'success':
      return 'bg-success';
    case 'danger':
      return 'bg-error';
    case 'warning':
      return 'bg-warning';
    case 'active':
      return 'bg-brand';
    default:
      return 'bg-secondary';
  }
}

function getNodeStatusToneClass(status: string) {
  switch (status) {
    case 'succeeded':
      return 'text-success';
    case 'failed':
    case 'canceled':
      return 'text-error';
    case 'awaiting_human':
    case 'awaiting_arena':
      return 'text-warning';
    case 'running':
      return 'text-brand';
    default:
      return 'text-low';
  }
}
