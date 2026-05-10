import { useEffect, useState } from 'react';
import type { WorkflowRunResponse } from 'shared/types';
import { useWorkflowTemplate } from '@/shared/hooks/useWorkflowTemplates';
import { useWorkflowRunMutations } from '@/shared/hooks/useWorkflowRun';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import {
  buildWorkflowRunDashboardSummary,
  formatWorkflowDuration,
  getNodeStatusTone,
  getNodeStatusLabel,
  getWorkflowRunStatusLabel,
} from '../model/workflowRunView';
import {
  Square,
  RefreshCcw,
  Check,
  X,
  Clock,
  ExternalLink,
  Code,
} from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { WorkflowArenaWinnerPanel } from './WorkflowArenaWinnerPanel';

export interface WorkflowRunDashboardTabProps {
  projectId: string;
  run: WorkflowRunResponse;
}

function getDefaultSelectedNodeId(run: WorkflowRunResponse): string | null {
  const actionableNode = run.nodes.find(
    (node) =>
      node.status === 'awaiting_arena' ||
      node.status === 'awaiting_human' ||
      node.status === 'failed' ||
      node.status === 'running'
  );

  return actionableNode?.node_id ?? run.nodes[0]?.node_id ?? null;
}

export function WorkflowRunDashboardTab({
  projectId,
  run,
}: WorkflowRunDashboardTabProps) {
  const { data: template } = useWorkflowTemplate(run.workflow_id);
  const mutations = useWorkflowRunMutations();
  const appNav = useAppNavigation();
  const summary = buildWorkflowRunDashboardSummary(run);
  const [actionError, setActionError] = useState<string | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    getDefaultSelectedNodeId(run)
  );

  useEffect(() => {
    if (
      selectedNodeId &&
      run.nodes.some((node) => node.node_id === selectedNodeId)
    ) {
      return;
    }

    setSelectedNodeId(getDefaultSelectedNodeId(run));
  }, [run, selectedNodeId]);

  const selectedNode =
    run.nodes.find((n) => n.node_id === selectedNodeId) || null;

  const handleCancelRun = async () => {
    setActionError(null);
    try {
      await mutations.cancelRun(run.id);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to cancel workflow run.'
      );
    }
  };

  const handleRetryNode = async (nodeId: string) => {
    setActionError(null);
    try {
      await mutations.retryNode({ runId: run.id, nodeId });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to retry workflow step.'
      );
    }
  };

  const handleApproveNode = async (nodeId: string) => {
    setActionError(null);
    try {
      await mutations.approveNode({
        runId: run.id,
        nodeId,
        payload: {},
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to approve workflow step.'
      );
    }
  };

  const handleRejectNode = async (nodeId: string) => {
    setActionError(null);
    try {
      await mutations.rejectNode({
        runId: run.id,
        nodeId,
        payload: {},
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to reject workflow step.'
      );
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto sm:flex-row">
      <div className="flex-1 space-y-4 p-base sm:w-2/3">
        {/* Header section */}
        <section className="rounded border border-secondary bg-panel p-4">
          <h2 className="mb-2 text-sm font-semibold text-high">Run Details</h2>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-low">Issue ID:</span>
              <span className="ml-2 text-high">{run.issue_id}</span>
            </div>
            <div>
              <span className="text-low">Workflow:</span>
              <span className="ml-2 text-high">
                {template?.name || run.workflow_id}
              </span>
            </div>
            <div>
              <span className="text-low">Run ID:</span>
              <span className="ml-2 text-high">{run.id}</span>
            </div>
            <div>
              <span className="text-low">Status:</span>
              <span
                className={cn(
                  'ml-2 font-medium',
                  getNodeStatusToneClass(run.status)
                )}
              >
                {getWorkflowRunStatusLabel(run.status)}
              </span>
            </div>
          </div>
        </section>

        {/* Progress */}
        <section className="rounded border border-secondary bg-panel p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-high">Progress</h2>
            {(run.status === 'running' ||
              run.status === 'pending' ||
              run.status === 'awaiting_human' ||
              run.status === 'awaiting_arena') && (
              <button
                className="flex items-center gap-1 rounded bg-secondary px-2 py-1 text-xs text-error hover:opacity-80"
                onClick={() => void handleCancelRun()}
                disabled={mutations.isCanceling}
              >
                <Square className="h-3 w-3" />
                Cancel Run
              </button>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex-1">
              <div className="mb-1 flex justify-between text-low">
                <span>
                  {summary.completedSteps} / {summary.totalSteps} steps
                  completed
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
              {formatWorkflowDuration(run.started_at, run.finished_at)}
            </div>
          </div>
        </section>

        {/* Steps Timeline */}
        <section className="rounded border border-secondary bg-panel p-4">
          <h2 className="mb-4 text-sm font-semibold text-high">
            Steps Timeline
          </h2>
          <div className="space-y-2">
            {run.nodes.length === 0 ? (
              <div className="text-xs text-low">No steps executed yet.</div>
            ) : (
              run.nodes.map((node) => (
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
                      {getNodeStatusLabel(node.status)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-low">
                    {node.session_id && (
                      <a
                        href={`/sessions/${node.session_id}`}
                        className="flex items-center gap-1 hover:text-brand"
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink className="h-3 w-3" /> Session
                      </a>
                    )}
                    <span>
                      {formatWorkflowDuration(
                        node.started_at,
                        node.finished_at
                      )}
                    </span>
                    {node.status === 'failed' && (
                      <button
                        className="rounded p-1 text-high hover:bg-secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleRetryNode(node.node_id);
                        }}
                        disabled={mutations.isRetrying}
                        title="Retry step"
                      >
                        <RefreshCcw className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Code Changes */}
        <section className="rounded border border-secondary bg-panel p-4">
          <h2 className="mb-2 text-sm font-semibold text-high">Code Changes</h2>
          {run.workspace_id ? (
            <button
              onClick={() =>
                appNav.goToProjectIssueWorkspace(
                  projectId,
                  run.issue_id,
                  run.workspace_id!
                )
              }
              className="inline-flex items-center gap-2 rounded bg-primary px-3 py-2 text-xs font-medium text-brand hover:underline border border-secondary"
            >
              <Code className="h-4 w-4" />
              Open Workflow Workspace
            </button>
          ) : (
            <div className="text-xs text-low italic">
              No code changes associated with this run.
            </div>
          )}
        </section>
      </div>

      {/* Side Column */}
      <div className="flex-1 space-y-4 border-l border-secondary bg-primary p-base sm:w-1/3 sm:flex-none sm:max-w-md">
        {/* Selected Step Detail */}
        <section className="rounded border border-secondary bg-panel p-4">
          <h2 className="mb-4 text-sm font-semibold text-high">
            {selectedNode ? `Step: ${selectedNode.node_id}` : 'Select a step'}
          </h2>
          {!selectedNode ? (
            <div className="text-xs text-low">No step selected.</div>
          ) : (
            <div className="space-y-4 text-xs">
              {actionError ? (
                <p className="text-xs text-error" role="alert">
                  {actionError}
                </p>
              ) : null}

              <div>
                <h3 className="font-medium text-low mb-1">Input</h3>
                <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-primary p-2 text-high border border-secondary font-mono text-[10px]">
                  {selectedNode.input_text || (
                    <span className="italic text-low">No input</span>
                  )}
                </pre>
              </div>

              <div>
                <h3 className="font-medium text-low mb-1">Output</h3>
                <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-primary p-2 text-high border border-secondary font-mono text-[10px]">
                  {selectedNode.output_text || (
                    <span className="italic text-low">No output</span>
                  )}
                </pre>
              </div>

              {selectedNode.error_text && (
                <div>
                  <h3 className="font-medium text-error mb-1">Error</h3>
                  <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-primary p-2 text-error border border-error/50 bg-error/10 font-mono text-[10px]">
                    {selectedNode.error_text}
                  </pre>
                </div>
              )}

              {selectedNode.status === 'awaiting_human' && (
                <div className="flex gap-2 pt-2">
                  <button
                    className="flex-1 rounded bg-success px-3 py-1.5 text-white font-medium hover:opacity-90 disabled:opacity-50"
                    onClick={() => void handleApproveNode(selectedNode.node_id)}
                    disabled={mutations.isApproving || mutations.isRejecting}
                  >
                    Approve
                  </button>
                  <button
                    className="flex-1 rounded bg-error px-3 py-1.5 text-white font-medium hover:opacity-90 disabled:opacity-50"
                    onClick={() => void handleRejectNode(selectedNode.node_id)}
                    disabled={mutations.isApproving || mutations.isRejecting}
                  >
                    Reject
                  </button>
                </div>
              )}

              {selectedNode.status === 'awaiting_arena' && (
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
            Decisions Made
          </h2>
          <div className="space-y-3 text-xs">
            {run.nodes.filter(
              (n) =>
                n.node_type === 'condition' ||
                n.node_type === 'human_gate' ||
                n.node_type === 'arena'
            ).length === 0 ? (
              <div className="text-low italic">
                No decision nodes in this run.
              </div>
            ) : (
              run.nodes
                .filter(
                  (n) =>
                    n.node_type === 'condition' ||
                    n.node_type === 'human_gate' ||
                    n.node_type === 'arena'
                )
                .map((node) => (
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
                        Condition met:{' '}
                        <span className="text-high">
                          {node.output_text || 'None'}
                        </span>
                      </div>
                    )}
                    {node.node_type === 'human_gate' && (
                      <div className="text-low mt-1">
                        Status:{' '}
                        <span
                          className={cn(
                            'font-medium',
                            getToneTextClass(getNodeStatusTone(node.status))
                          )}
                        >
                          {getNodeStatusLabel(node.status)}
                        </span>
                      </div>
                    )}
                    {node.node_type === 'arena' && (
                      <div className="text-low mt-1 space-y-1">
                        <div>
                          Status:{' '}
                          <span className="text-high">
                            {getNodeStatusLabel(node.status)}
                          </span>
                        </div>
                        {node.arena_group_id && (
                          <div>
                            Arena Group:{' '}
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
                            Pick winner
                          </button>
                        )}
                        {node.output_text && (
                          <div>
                            Winner:{' '}
                            <span className="text-success">
                              {node.output_text}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
            )}
          </div>
        </section>

        {/* Agent Contribution */}
        <section className="rounded border border-secondary bg-panel p-4">
          <h2 className="mb-3 text-sm font-semibold text-high">
            Agent Contribution
          </h2>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-low">Total Tokens:</span>
              <span className="text-high font-medium">
                {summary.totalTokens > 0
                  ? summary.totalTokens.toLocaleString()
                  : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-low">Estimated Cost:</span>
              <span className="text-high font-medium">
                {summary.totalCostEstimate > 0
                  ? `$${summary.totalCostEstimate.toFixed(4)}`
                  : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-low">Agent Steps:</span>
              <span className="text-high font-medium">
                {run.nodes.filter((n) => n.node_type === 'agent').length}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-low">Control Steps:</span>
              <span className="text-high font-medium">
                {run.nodes.filter((n) => n.node_type !== 'agent').length}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// Helpers for styling
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
