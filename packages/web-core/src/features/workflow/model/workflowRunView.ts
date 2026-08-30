import type {
  NodeExecutionStatus,
  WorkflowNodeExecutionResponse,
  WorkflowRunRuntimeView,
  WorkflowRunResponse,
  WorkflowRunStatus,
} from 'shared/types';
import type { WorkflowGraph } from './workflowGraph';
import {
  getWorkflowNodeExecutionForWork,
  getWorkflowNodeWork,
  getWorkflowRuntimeView,
  type WorkflowRuntimeProjection,
} from './workflowRuntimeView';

type CanonicalWorkflowNodeExecution = WorkflowNodeExecutionResponse & {
  orchestration_node_execution_id?: string | null;
  agent_run_id?: string | null;
  projection_status?: import('shared/types').ProjectionStatus | null;
};

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
    case 'cancelling':
      return 'Cancelling';
  }
}

export function getWorkflowRunTaskAttemptLabel(
  run: Pick<WorkflowRunResponse, 'id' | 'attempt_id'>
): string {
  if (run.attempt_id) {
    return `Task attempt ${run.attempt_id.slice(0, 9)}`;
  }
  return `Workflow run ${run.id.slice(0, 8)}`;
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
    case 'cancelling':
      return 'warning';
    case 'cancelled':
      return 'neutral';
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
  skippedSteps: number;
  waitingSteps: number;
  failedSteps: number;
  runningSteps: number;
  progressPercent: number;
  totalTokens: number;
  totalCostEstimate: number;
}

export function buildWorkflowRunDashboardSummary(
  run: WorkflowRunResponse,
  runtimeView?: WorkflowRunRuntimeView | WorkflowRuntimeProjection | null
): WorkflowRunDashboardSummary {
  const nodes = run.nodes;
  const workItems = runtimeView?.node_work;
  const totalSteps = workItems?.length ?? 0;

  let completedSteps = 0;
  let skippedSteps = 0;
  let waitingSteps = 0;
  let failedSteps = 0;
  let runningSteps = 0;
  let totalTokens = 0;
  let totalCostEstimate = 0;

  if (workItems) {
    for (const work of workItems) {
      if (work.status === 'succeeded') {
        completedSteps++;
      } else if (work.status === 'skipped') {
        skippedSteps++;
      } else if (
        work.status === 'awaiting_human' ||
        work.status === 'awaiting_arena' ||
        work.status === 'cancelling'
      ) {
        waitingSteps++;
      } else if (work.status === 'failed') {
        failedSteps++;
      } else if (work.status === 'running' || work.status === 'starting') {
        runningSteps++;
      }
    }
  } else {
    return {
      totalSteps: 0,
      completedSteps: 0,
      skippedSteps: 0,
      waitingSteps: 0,
      failedSteps: 0,
      runningSteps: 0,
      progressPercent: 0,
      totalTokens: 0,
      totalCostEstimate: 0,
    };
  }

  for (const node of nodes) {
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
    skippedSteps,
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

export interface AgentSessionRow {
  runId: string;
  runLabel: string;
  nodeId: string;
  sessionId: string | null;
  orchestrationNodeExecutionId: string | null;
  agentRunId: string | null;
  projectionStatus: import('shared/types').ProjectionStatus | null;
  statusLabel: string;
  startedLabel: string;
  durationLabel: string;
  outputPreview: string;
}

export function buildAgentSessionRows(
  run: WorkflowRunResponse,
  nodeId: string | null
): AgentSessionRow[] {
  if (!nodeId) return [];

  const runtimeView = getWorkflowRuntimeView(run);
  const rows = runtimeView.node_work
    .filter((work) => work.node_id === nodeId && work.node_type === 'agent')
    .map((work) => {
      const node = getWorkflowNodeExecutionForWork(run, work);
      if (!node) return null;
      const canonicalNode = node as CanonicalWorkflowNodeExecution;
      return {
        runId: run.id,
        runLabel: run.id,
        nodeId: work.node_id,
        sessionId: work.active_session_id,
        orchestrationNodeExecutionId:
          canonicalNode.orchestration_node_execution_id ?? null,
        agentRunId:
          canonicalNode.agent_run_id ?? work.active_agent_run_id ?? null,
        projectionStatus:
          canonicalNode.projection_status ?? work.projection_status ?? null,
        statusLabel: getNodeStatusLabel(node.status),
        startedLabel: node.started_at ?? 'Not started',
        durationLabel: formatWorkflowDuration(
          node.started_at,
          node.finished_at
        ),
        outputPreview: node.output_text ?? 'No output yet',
      } satisfies AgentSessionRow;
    });
  return rows.filter((row): row is AgentSessionRow => row !== null);
}

export interface WorkflowNodeDebugView {
  nodeId: string;
  promptTemplate: string | null;
  renderedPrompt: string | null;
  rawInput: string | null;
  outputText: string | null;
  errorText: string | null;
  sessionId: string | null;
  orchestrationNodeExecutionId: string | null;
  agentRunId: string | null;
  upstreamOutputs: Array<{ nodeId: string; outputText: string }>;
}

export function buildWorkflowNodeDebugView({
  graph,
  nodeId,
  run,
}: {
  graph: WorkflowGraph;
  nodeId: string;
  run: WorkflowRunResponse;
}): WorkflowNodeDebugView | null {
  const graphNode = graph.nodes.find((node) => node.id === nodeId);
  const runtimeView = getWorkflowRuntimeView(run);
  const work = getWorkflowNodeWork(runtimeView, nodeId);
  const execution = getWorkflowNodeExecutionForWork(run, work);
  if (!graphNode || !execution) return null;

  const upstreamOutputs = graph.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => {
      const upstreamWork = getWorkflowNodeWork(runtimeView, edge.source);
      const upstream = getWorkflowNodeExecutionForWork(run, upstreamWork);
      return upstream?.output_text
        ? { nodeId: edge.source, outputText: upstream.output_text }
        : null;
    })
    .filter((item): item is { nodeId: string; outputText: string } =>
      Boolean(item)
    );

  return {
    nodeId,
    promptTemplate: graphNode.data.prompt_template ?? null,
    renderedPrompt: execution.input_text,
    rawInput: run.input_text,
    outputText: execution.output_text,
    errorText: execution.error_text,
    sessionId: execution.session_id,
    orchestrationNodeExecutionId:
      (execution as CanonicalWorkflowNodeExecution)
        .orchestration_node_execution_id ?? null,
    agentRunId:
      (execution as CanonicalWorkflowNodeExecution).agent_run_id ?? null,
    upstreamOutputs,
  };
}
