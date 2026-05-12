import type {
  NodeExecutionStatus,
  WorkflowNodeExecutionResponse,
  WorkflowRunResponse,
  WorkflowRunStatus,
} from 'shared/types';
import type {
  ArenaGroupResponse,
  ArenaWorkspaceSummary,
} from '@/shared/lib/arenaApi';

export function getWorkflowRunStatusLabel(status: WorkflowRunStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'running':
      return 'Running';
    case 'awaiting_human':
      return 'Waiting for human';
    case 'awaiting_arena':
      return 'Waiting for arena';
    case 'succeeded':
      return 'Succeeded';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
  }
}

export type StatusTone =
  | 'neutral'
  | 'active'
  | 'success'
  | 'danger'
  | 'warning';

export function getNodeStatusTone(status: NodeExecutionStatus): StatusTone {
  switch (status) {
    case 'pending':
      return 'neutral';
    case 'running':
      return 'active';
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'danger';
    case 'awaiting_human':
    case 'awaiting_arena':
      return 'warning';
    case 'skipped':
      return 'neutral';
  }
}

export function getNodeStatusLabel(status: NodeExecutionStatus): string {
  return status.replace(/_/g, ' ');
}

export function selectWorkflowRunNode(
  run: WorkflowRunResponse,
  nodeId: string | null
): WorkflowNodeExecutionResponse | null {
  if (nodeId) {
    const node = run.nodes.find((n) => n.node_id === nodeId);
    if (node) return node;
  }
  return run.nodes.length > 0 ? run.nodes[0] : null;
}

export interface WorkflowRunDashboardSummary {
  totalSteps: number;
  completedSteps: number;
  waitingSteps: number;
  failedSteps: number;
  runningSteps: number;
  progressPercent: number;
  totalTokens: number;
  totalCostEstimate: number;
}

export function buildWorkflowRunDashboardSummary(
  run: WorkflowRunResponse
): WorkflowRunDashboardSummary {
  const nodes = run.nodes;
  const totalSteps = nodes.length;

  let completedSteps = 0;
  let waitingSteps = 0;
  let failedSteps = 0;
  let runningSteps = 0;
  let totalTokens = 0;
  let totalCostEstimate = 0;

  for (const node of nodes) {
    if (node.status === 'succeeded' || node.status === 'skipped') {
      completedSteps++;
    } else if (
      node.status === 'awaiting_human' ||
      node.status === 'awaiting_arena'
    ) {
      waitingSteps++;
    } else if (node.status === 'failed') {
      failedSteps++;
    } else if (node.status === 'running') {
      runningSteps++;
    }

    if (node.tokens_used !== null && node.tokens_used !== undefined) {
      totalTokens += Number(node.tokens_used);
    }
    if (node.cost_estimate !== null && node.cost_estimate !== undefined) {
      totalCostEstimate += node.cost_estimate;
    }
  }

  const progressPercent =
    totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  return {
    totalSteps,
    completedSteps,
    waitingSteps,
    failedSteps,
    runningSteps,
    progressPercent,
    totalTokens,
    totalCostEstimate,
  };
}

export function formatWorkflowDuration(
  start: string | null,
  end: string | null
): string {
  if (!start) return 'Not started';

  const startTime = new Date(start).getTime();
  const endTime = end ? new Date(end).getTime() : Date.now();

  const diffMs = endTime - startTime;
  if (diffMs < 0) return '0s';

  const diffSecs = Math.floor(diffMs / 1000);
  const minutes = Math.floor(diffSecs / 60);
  const seconds = diffSecs % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

type WorkflowNodeExecutionWithProcess = WorkflowNodeExecutionResponse & {
  execution_process_id?: string | null;
};

export interface AgentSessionRow {
  runId: string;
  runLabel: string;
  nodeId: string;
  sessionId: string | null;
  executionProcessId: string | null;
  statusLabel: string;
  startedLabel: string;
  durationLabel: string;
  outputPreview: string;
}

export function getNodeExecutionProcessId(
  node: WorkflowNodeExecutionResponse
): string | null {
  return (
    (node as WorkflowNodeExecutionWithProcess).execution_process_id ?? null
  );
}

export function buildWorkspaceSessionHref(
  workspaceHref: string | null | undefined,
  sessionId: string | null | undefined
): string | null {
  if (!workspaceHref || !sessionId) return null;

  const [pathAndQuery, hash] = workspaceHref.split('#');
  const separator = pathAndQuery.includes('?') ? '&' : '?';
  const nextHref = `${pathAndQuery}${separator}session_id=${encodeURIComponent(
    sessionId
  )}`;

  return hash ? `${nextHref}#${hash}` : nextHref;
}

export function buildAgentSessionRows(
  run: WorkflowRunResponse,
  nodeId: string | null
): AgentSessionRow[] {
  if (!nodeId) return [];

  return run.nodes
    .filter((node) => node.node_id === nodeId && node.node_type === 'agent')
    .map((node) => ({
      runId: run.id,
      runLabel: run.id,
      nodeId: node.node_id,
      sessionId: node.session_id,
      executionProcessId: getNodeExecutionProcessId(node),
      statusLabel: getNodeStatusLabel(node.status),
      startedLabel: node.started_at ?? 'Not started',
      durationLabel: formatWorkflowDuration(node.started_at, node.finished_at),
      outputPreview: node.output_text ?? 'No output yet',
    }));
}

export interface ArenaWinnerOption {
  workspaceId: string;
  label: string;
  branch: string;
  executorLabel: string;
  arenaStatusLabel: string;
  executionStatusLabel: string;
  hasUncommittedChanges: boolean | null;
  isSelectable: boolean;
  isPromoted: boolean;
}

function formatStatus(value: string | null | undefined, fallback: string) {
  return value ? value.replace(/_/g, ' ') : fallback;
}

function arenaWinnerLabel(workspace: ArenaWorkspaceSummary, index: number) {
  return workspace.name || workspace.executor || `Attempt ${index + 1}`;
}

function arenaWinnerExecutorLabel(workspace: ArenaWorkspaceSummary) {
  const parts = [workspace.executor, workspace.variant].filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : 'Unknown executor';
}

export function buildArenaWinnerOptions(
  group: ArenaGroupResponse | null | undefined
): ArenaWinnerOption[] {
  if (!group) return [];

  const groupAlreadyPromoted = group.promoted_workspace_id !== null;

  return group.workspaces
    .filter((workspace) => workspace.purpose === 'attempt')
    .map((workspace, index) => {
      const isPromoted =
        group.promoted_workspace_id === workspace.workspace_id ||
        workspace.arena_status === 'promoted';
      const executionStatus = workspace.latest_execution_status;
      const isExecutionFinished = executionStatus === 'completed';
      const isSelectable =
        !groupAlreadyPromoted &&
        workspace.arena_status === 'active' &&
        isExecutionFinished;

      return {
        workspaceId: workspace.workspace_id,
        label: arenaWinnerLabel(workspace, index),
        branch: workspace.branch,
        executorLabel: arenaWinnerExecutorLabel(workspace),
        arenaStatusLabel: formatStatus(workspace.arena_status, 'unknown'),
        executionStatusLabel: formatStatus(executionStatus, 'not started'),
        hasUncommittedChanges: workspace.has_uncommitted_changes,
        isSelectable,
        isPromoted,
      };
    });
}
