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
