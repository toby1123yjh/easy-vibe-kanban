import type {
  NodeExecutionStatus,
  WorkflowNodeExecutionResponse,
} from 'shared/types';
import type {
  WorkflowGraph,
  WorkflowNodeData,
  WorkflowNodeKind,
} from './workflowGraph';

export type WorkflowCanvasNodeState =
  | 'draft'
  | 'configured'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'waiting'
  | 'skipped';

export type WorkflowCanvasEdgeState =
  | 'idle'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'waiting'
  | 'skipped';

export type WorkflowNodeExecutionStatusMap = Record<
  string,
  NodeExecutionStatus
>;

const NODE_STATE_LABELS: Record<WorkflowCanvasNodeState, string> = {
  draft: 'Draft',
  configured: 'Configured',
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Done',
  failed: 'Failed',
  waiting: 'Waiting',
  skipped: 'Skipped',
};

function hasConfiguredAgentData(data: WorkflowNodeData): boolean {
  const prompt = data.prompt_template;
  const executorConfig = data.executor_config;
  return (
    (typeof prompt === 'string' && prompt.trim().length > 0) ||
    executorConfig != null
  );
}

function isAfterExecution(
  next: WorkflowNodeExecutionResponse,
  current: WorkflowNodeExecutionResponse
): boolean {
  if (next.iteration !== current.iteration) {
    return next.iteration > current.iteration;
  }

  return next.updated_at > current.updated_at;
}

export function buildWorkflowNodeExecutionStatusMap(
  executions: WorkflowNodeExecutionResponse[] | null | undefined
): WorkflowNodeExecutionStatusMap {
  const latestByNodeId = new Map<string, WorkflowNodeExecutionResponse>();

  for (const execution of executions ?? []) {
    const current = latestByNodeId.get(execution.node_id);
    if (!current || isAfterExecution(execution, current)) {
      latestByNodeId.set(execution.node_id, execution);
    }
  }

  return Object.fromEntries(
    Array.from(latestByNodeId.entries()).map(([nodeId, execution]) => [
      nodeId,
      execution.status,
    ])
  );
}

export function getWorkflowCanvasNodeState({
  data,
  executionStatus,
  nodeType,
}: {
  data: WorkflowNodeData;
  executionStatus?: NodeExecutionStatus;
  nodeType: WorkflowNodeKind;
}): WorkflowCanvasNodeState {
  switch (executionStatus) {
    case 'pending':
      return 'pending';
    case 'running':
      return 'running';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'awaiting_human':
    case 'awaiting_arena':
      return 'waiting';
    case 'skipped':
      return 'skipped';
    default:
      return nodeType === 'agent' && !hasConfiguredAgentData(data)
        ? 'draft'
        : 'configured';
  }
}

export function getWorkflowCanvasNodeStateLabel(
  state: WorkflowCanvasNodeState
): string {
  return NODE_STATE_LABELS[state];
}

export function getWorkflowCanvasEdgeState(
  sourceStatus: NodeExecutionStatus | undefined
): WorkflowCanvasEdgeState {
  switch (sourceStatus) {
    case 'running':
      return 'running';
    case 'succeeded':
      return 'succeeded';
    case 'failed':
      return 'failed';
    case 'awaiting_human':
    case 'awaiting_arena':
      return 'waiting';
    case 'skipped':
      return 'skipped';
    default:
      return 'idle';
  }
}

export function buildWorkflowEdgeStateMap(
  graph: WorkflowGraph,
  nodeStatuses: WorkflowNodeExecutionStatusMap | null | undefined
): Record<string, WorkflowCanvasEdgeState> {
  return Object.fromEntries(
    graph.edges.map((edge) => [
      edge.id,
      getWorkflowCanvasEdgeState(nodeStatuses?.[edge.source]),
    ])
  );
}
