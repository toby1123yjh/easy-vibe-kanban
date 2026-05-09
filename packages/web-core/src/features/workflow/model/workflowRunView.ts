import type {
  NodeExecutionStatus,
  WorkflowNodeExecutionResponse,
  WorkflowRunResponse,
  WorkflowRunStatus,
} from 'shared/types';

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
