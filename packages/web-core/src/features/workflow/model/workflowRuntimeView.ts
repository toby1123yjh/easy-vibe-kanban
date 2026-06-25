import type {
  NodeExecutionStatus,
  WorkflowNodeExecutionResponse,
  WorkflowNodeWorkStatus,
  WorkflowNodeWorkView,
  WorkflowRunResponse,
  WorkflowRunRuntimeView,
} from 'shared/types';

export const WORKFLOW_NODE_ACTIVE_SLOW_THRESHOLD_MS = 5 * 60 * 1000;

export interface WorkflowRuntimeViewOptions {
  nowMs?: number;
  activeSlowThresholdMs?: number;
}

export interface WorkflowNodeActionGate {
  canOpenSession: boolean;
  canRetry: boolean;
  canApprove: boolean;
  canReject: boolean;
  canSelectArenaWinner: boolean;
  canSelectConditionBranch: boolean;
  canCancelNode: boolean;
}

export interface WorkflowNodeRuntimeSummary {
  status: WorkflowNodeWorkStatus;
  runtimeHealth: WorkflowNodeWorkView['runtime_health'];
  activeElapsedMs: number | null;
  activeSlow: boolean;
  pendingWorkCount: number;
  startingChildCount: number;
}

export function getWorkflowRuntimeView(
  run: WorkflowRunResponse,
  options: WorkflowRuntimeViewOptions = {}
): WorkflowRunRuntimeView {
  if (run.runtime_view) {
    return run.runtime_view;
  }

  return buildFallbackWorkflowRuntimeView(run, options);
}

export function getWorkflowNodeWork(
  view: WorkflowRunRuntimeView,
  nodeId: string | null | undefined
): WorkflowNodeWorkView | null {
  if (!nodeId) return null;
  return view.node_work.find((work) => work.node_id === nodeId) ?? null;
}

export function isWorkflowNodeProcessing(
  work: WorkflowNodeWorkView | null | undefined
): boolean {
  return work?.status === 'starting' || work?.status === 'running';
}

export function getWorkflowNodeActionGate(
  work: WorkflowNodeWorkView | null | undefined
): WorkflowNodeActionGate {
  return {
    canOpenSession: work?.can_open_session ?? false,
    canRetry: work?.can_retry ?? false,
    canApprove: work?.can_approve ?? false,
    canReject: work?.can_reject ?? false,
    canSelectArenaWinner: work?.can_select_arena_winner ?? false,
    canSelectConditionBranch: work?.can_select_condition_branch ?? false,
    canCancelNode: work?.can_cancel_node ?? false,
  };
}

export function getWorkflowNodeRuntimeSummary(
  work: WorkflowNodeWorkView
): WorkflowNodeRuntimeSummary {
  return {
    status: work.status,
    runtimeHealth: work.runtime_health,
    activeElapsedMs: work.active_elapsed_ms,
    activeSlow: work.active_slow,
    pendingWorkCount: work.pending_work_count,
    startingChildCount: work.starting_child_count,
  };
}

export function getDefaultWorkflowRuntimeNodeId(
  view: WorkflowRunRuntimeView
): string | null {
  const waiting = view.node_work.find((work) =>
    isWaitingWorkflowNodeWorkStatus(work.status)
  );
  if (waiting) return waiting.node_id;

  const failed = view.node_work.find((work) => work.status === 'failed');
  if (failed) return failed.node_id;

  const active = view.node_work.find((work) =>
    isActiveWorkflowNodeWorkStatus(work.status)
  );
  if (active) return active.node_id;

  return view.node_work[0]?.node_id ?? null;
}

function buildFallbackWorkflowRuntimeView(
  run: WorkflowRunResponse,
  options: WorkflowRuntimeViewOptions
): WorkflowRunRuntimeView {
  const nowMs = options.nowMs ?? Date.now();
  const activeSlowThresholdMs =
    options.activeSlowThresholdMs ?? WORKFLOW_NODE_ACTIVE_SLOW_THRESHOLD_MS;
  const grouped = new Map<string, WorkflowNodeExecutionResponse[]>();
  const orderedNodeIds: string[] = [];

  for (const node of run.nodes) {
    if (!grouped.has(node.node_id)) {
      orderedNodeIds.push(node.node_id);
      grouped.set(node.node_id, []);
    }
    grouped.get(node.node_id)?.push(node);
  }

  const nodeWork = orderedNodeIds
    .map((nodeId) => {
      const executions = grouped.get(nodeId) ?? [];
      const current = selectLatestNodeExecution(executions);
      return current
        ? buildFallbackNodeWorkView(current, executions, {
            nowMs,
            activeSlowThresholdMs,
          })
        : null;
    })
    .filter((work): work is WorkflowNodeWorkView => Boolean(work));

  return {
    run_id: run.id,
    status: run.status,
    active_node_count: nodeWork.filter(isActiveWorkflowNodeWork).length,
    pending_node_count: nodeWork.filter((work) => work.status === 'pending')
      .length,
    waiting_node_count: nodeWork.filter(isWaitingWorkflowNodeWork).length,
    failed_node_count: nodeWork.filter((work) => work.status === 'failed')
      .length,
    completed_node_count: nodeWork.filter(
      (work) => work.status === 'succeeded' || work.status === 'skipped'
    ).length,
    node_work: nodeWork,
  };
}

function buildFallbackNodeWorkView(
  current: WorkflowNodeExecutionResponse,
  executions: WorkflowNodeExecutionResponse[],
  {
    nowMs,
    activeSlowThresholdMs,
  }: {
    nowMs: number;
    activeSlowThresholdMs: number;
  }
): WorkflowNodeWorkView {
  const status = workflowNodeWorkStatus(current);
  const active = isActiveWorkflowNodeWorkStatus(status);
  const waiting = isWaitingWorkflowNodeWorkStatus(status);
  const activeElapsedMs = active
    ? calculateElapsedMs(current.started_at, nowMs)
    : null;
  const activeSlow =
    activeElapsedMs !== null && activeElapsedMs >= activeSlowThresholdMs;

  return {
    node_id: current.node_id,
    node_type: current.node_type,
    iteration: current.iteration,
    status,
    pending_work_count: executions.filter((node) => node.status === 'pending')
      .length,
    starting_child_count: executions.filter(
      (node) => node.status === 'running' && !node.execution_process_id
    ).length,
    active_execution_id: active || waiting ? current.id : null,
    active_session_id: current.session_id,
    execution_process_id: current.execution_process_id,
    active_started_at: active || waiting ? current.started_at : null,
    active_elapsed_ms: activeElapsedMs,
    active_slow: activeSlow,
    active_slow_threshold_ms: activeSlowThresholdMs,
    runtime_health: workflowRuntimeHealth(current, status, activeSlow),
    can_open_session:
      Boolean(current.session_id) &&
      (current.node_type === 'agent' || current.node_type === 'condition'),
    can_retry: current.status === 'failed',
    can_approve:
      current.status === 'awaiting_human' && current.node_type === 'human_gate',
    can_reject:
      current.status === 'awaiting_human' && current.node_type === 'human_gate',
    can_select_arena_winner:
      current.status === 'awaiting_arena' && current.node_type === 'arena',
    can_select_condition_branch:
      current.status === 'awaiting_human' && current.node_type === 'condition',
    can_cancel_node: false,
  };
}

function selectLatestNodeExecution(
  executions: WorkflowNodeExecutionResponse[]
): WorkflowNodeExecutionResponse | null {
  let latest: WorkflowNodeExecutionResponse | null = null;

  for (const execution of executions) {
    if (!latest || isAfterNodeExecution(execution, latest)) {
      latest = execution;
    }
  }

  return latest;
}

function isAfterNodeExecution(
  next: WorkflowNodeExecutionResponse,
  current: WorkflowNodeExecutionResponse
): boolean {
  if (next.iteration !== current.iteration) {
    return next.iteration > current.iteration;
  }

  return next.updated_at > current.updated_at;
}

function workflowNodeWorkStatus(
  node: WorkflowNodeExecutionResponse
): WorkflowNodeWorkStatus {
  if (node.status === 'running' && !node.execution_process_id) {
    return 'starting';
  }
  return node.status;
}

function workflowRuntimeHealth(
  node: WorkflowNodeExecutionResponse,
  status: WorkflowNodeWorkStatus,
  activeSlow: boolean
): WorkflowNodeWorkView['runtime_health'] {
  if (status === 'starting' && activeSlow) return 'process_missing';
  if (status === 'starting') return 'starting';
  if (status === 'running' && activeSlow) return 'slow';
  if (status === 'pending' && !node.started_at) return 'unknown';
  return 'ok';
}

function calculateElapsedMs(startedAt: string | null, nowMs: number) {
  if (!startedAt) return null;
  const startedMs = new Date(startedAt).getTime();
  if (Number.isNaN(startedMs)) return null;
  return Math.max(0, Math.floor(nowMs - startedMs));
}

function isActiveWorkflowNodeWork(work: WorkflowNodeWorkView): boolean {
  return isActiveWorkflowNodeWorkStatus(work.status);
}

function isActiveWorkflowNodeWorkStatus(
  status: WorkflowNodeWorkStatus
): boolean {
  return status === 'starting' || status === 'running';
}

function isWaitingWorkflowNodeWork(work: WorkflowNodeWorkView): boolean {
  return isWaitingWorkflowNodeWorkStatus(work.status);
}

function isWaitingWorkflowNodeWorkStatus(
  status: WorkflowNodeWorkStatus | NodeExecutionStatus
): boolean {
  return status === 'awaiting_human' || status === 'awaiting_arena';
}
