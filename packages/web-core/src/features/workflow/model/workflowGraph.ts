import type {
  Node as ReactFlowNode,
  Edge as ReactFlowEdge,
} from '@xyflow/react';
import { createDefaultNodeData } from './workflowNodeCatalog';
import { getWorkflowEdgeLabel } from './workflowPresentation';

export const WORKFLOW_GRAPH_VERSION = 2;
export const DEFAULT_SOURCE_HANDLE = 'output-right';
export const DEFAULT_TARGET_HANDLE = 'input-left';

export type WorkflowNodeKind =
  | 'start'
  | 'end'
  | 'agent'
  | 'condition'
  | 'human_gate'
  | 'transform'
  | 'arena';

export const WORKFLOW_NODE_DRAG_DATA_TYPE = 'application/x-vibe-workflow-node';

const WORKFLOW_NODE_KINDS: readonly WorkflowNodeKind[] = [
  'start',
  'end',
  'agent',
  'condition',
  'human_gate',
  'transform',
  'arena',
];

export function isWorkflowNodeKind(value: string): value is WorkflowNodeKind {
  return WORKFLOW_NODE_KINDS.includes(value as WorkflowNodeKind);
}

export type WorkflowEdgeKind =
  | 'default'
  | 'condition_branch'
  | 'approval'
  | 'rejection'
  | 'arena_winner';

export const WORKFLOW_REACT_FLOW_EDGE_TYPE = 'workflow';

const WORKFLOW_EDGE_KINDS: readonly WorkflowEdgeKind[] = [
  'default',
  'condition_branch',
  'approval',
  'rejection',
  'arena_winner',
];

export function isWorkflowEdgeKind(value: unknown): value is WorkflowEdgeKind {
  return (
    typeof value === 'string' &&
    WORKFLOW_EDGE_KINDS.includes(value as WorkflowEdgeKind)
  );
}

export type OutputCaptureMode = 'last_message' | 'full_text' | 'diff_summary';
export type PromoteStrategy = 'manual';
export type ApplyStrategy = 'diff_apply';
export type ConditionOperator = 'contains' | 'equals' | 'not_equals' | 'regex';
export type ConditionJoiner = 'and' | 'or';
export type RequiredAction = 'approve' | 'approve_or_reject';
export type TransformMode = 'template' | 'regex_extract' | 'truncate';

export interface WorkflowConditionRule {
  id?: string;
  input?: string;
  operator?: ConditionOperator;
  value?: string;
}

export interface WorkflowConditionBranch {
  name?: string;
  target_node_id?: string;
}

export interface WorkflowArenaAttemptConfig {
  id?: string;
  display_name?: string;
  role_template_id?: string;
  executor_config?: unknown;
  prompt_template?: string;
}

export interface WorkflowNodeData extends Record<string, unknown> {
  display_name?: string;
  role_template_id?: string;
  executor_config?: unknown;
  prompt_template?: string;
  output_capture?: OutputCaptureMode;
  attempts?: WorkflowArenaAttemptConfig[];
  promote_strategy?: PromoteStrategy;
  apply_strategy?: ApplyStrategy;
  conditions?: WorkflowConditionRule[];
  joiner?: ConditionJoiner;
  branches?: WorkflowConditionBranch[];
  prompt_to_human?: string;
  required_action?: RequiredAction;
  mode?: TransformMode;
  template?: string;
  regex?: string;
  max_chars?: number;
}

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeKind;
  data: WorkflowNodeData;
  position?: WorkflowNodePosition;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  source_handle?: string;
  target: string;
  target_handle?: string;
  type: WorkflowEdgeKind;
}

export interface WorkflowGraph {
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

type LegacyWorkflowEdge = Omit<
  WorkflowEdge,
  'source_handle' | 'target_handle'
> &
  Partial<Pick<WorkflowEdge, 'source_handle' | 'target_handle'>>;

type LegacyWorkflowGraph = Omit<WorkflowGraph, 'edges'> & {
  edges: LegacyWorkflowEdge[];
};

export interface ReactFlowWorkflowEdgeData extends Record<string, unknown> {
  workflowType: WorkflowEdgeKind;
}

export interface WorkflowNodePosition {
  x: number;
  y: number;
}

function getConditionBranchContext(
  graph: WorkflowGraph,
  edgeId: string
): { edge: WorkflowEdge; sourceNode: WorkflowNode } | null {
  const edge = graph.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return null;

  const sourceNode = graph.nodes.find((node) => node.id === edge.source);
  if (!sourceNode || sourceNode.type !== 'condition') return null;

  return { edge, sourceNode };
}

export function getConditionBranchNamesForEdge(
  graph: WorkflowGraph,
  edgeId: string
): string[] {
  const context = getConditionBranchContext(graph, edgeId);
  if (!context) return [];

  return (context.sourceNode.data.branches ?? [])
    .map((branch) => branch.name)
    .filter((name): name is string => Boolean(name));
}

export function getConditionBranchNameForEdge(
  graph: WorkflowGraph,
  edgeId: string
): string | null {
  const context = getConditionBranchContext(graph, edgeId);
  if (!context) return null;

  const branch = context.sourceNode.data.branches?.find(
    (candidate) => candidate.target_node_id === context.edge.target
  );
  return branch?.name ?? null;
}

function clearBranchTarget(branch: WorkflowConditionBranch) {
  const next = { ...branch };
  delete next.target_node_id;
  return next;
}

export function setConditionBranchTargetForEdge(
  graph: WorkflowGraph,
  edgeId: string,
  branchName: string
): WorkflowGraph {
  const context = getConditionBranchContext(graph, edgeId);
  if (!context) return graph;

  const branches = context.sourceNode.data.branches ?? [];
  const nextBranches = branches.map((branch) => {
    if (branch.name === branchName) {
      return { ...branch, target_node_id: context.edge.target };
    }
    if (branch.target_node_id === context.edge.target) {
      return clearBranchTarget(branch);
    }
    return branch;
  });

  if (!nextBranches.some((branch) => branch.name === branchName)) {
    nextBranches.push({
      name: branchName,
      target_node_id: context.edge.target,
    });
  }

  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === context.sourceNode.id
        ? {
            ...node,
            data: {
              ...node.data,
              branches: nextBranches,
            },
          }
        : node
    ),
  };
}

export function clearConditionBranchTargetForEdge(
  graph: WorkflowGraph,
  edgeId: string
): WorkflowGraph {
  const context = getConditionBranchContext(graph, edgeId);
  if (!context) return graph;

  const branches = context.sourceNode.data.branches ?? [];
  const nextBranches = branches.map((branch) =>
    branch.target_node_id === context.edge.target
      ? clearBranchTarget(branch)
      : branch
  );

  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === context.sourceNode.id
        ? {
            ...node,
            data: {
              ...node.data,
              branches: nextBranches,
            },
          }
        : node
    ),
  };
}

export function createDefaultWorkflowGraph(): WorkflowGraph {
  return {
    version: WORKFLOW_GRAPH_VERSION,
    nodes: [
      {
        id: 'start',
        type: 'start',
        data: { display_name: 'Start' },
      },
      {
        id: 'end',
        type: 'end',
        data: { display_name: 'End' },
      },
    ],
    edges: [
      {
        id: 'start-end',
        source: 'start',
        source_handle: DEFAULT_SOURCE_HANDLE,
        target: 'end',
        target_handle: DEFAULT_TARGET_HANDLE,
        type: 'default',
      },
    ],
  };
}

export function migrateWorkflowGraph(
  graph: WorkflowGraph | LegacyWorkflowGraph
): WorkflowGraph {
  return {
    ...graph,
    version: WORKFLOW_GRAPH_VERSION,
    edges: graph.edges.map((edge) => ({
      ...edge,
      source_handle: edge.source_handle ?? DEFAULT_SOURCE_HANDLE,
      target_handle: edge.target_handle ?? DEFAULT_TARGET_HANDLE,
    })),
  };
}

export function createWorkflowNode(
  kind: WorkflowNodeKind,
  options?: {
    id?: string;
    data?: Partial<WorkflowNodeData>;
    position?: WorkflowNodePosition;
  }
): WorkflowNode {
  return {
    id: options?.id ?? `${kind}-${crypto.randomUUID().slice(0, 8)}`,
    type: kind,
    data: {
      ...createDefaultNodeData(kind),
      ...(options?.data ?? {}),
    },
    ...(options?.position ? { position: options.position } : {}),
  };
}

export function createWorkflowEdge(options: {
  id?: string;
  source: string;
  source_handle?: string;
  target: string;
  target_handle?: string;
  type?: WorkflowEdgeKind;
}): WorkflowEdge {
  return {
    id: options.id ?? `${options.source}-${options.target}`,
    source: options.source,
    source_handle: options.source_handle ?? DEFAULT_SOURCE_HANDLE,
    target: options.target,
    target_handle: options.target_handle ?? DEFAULT_TARGET_HANDLE,
    type: options.type ?? 'default',
  };
}

export function toReactFlowNodes(
  graph: WorkflowGraph,
  positions?: Record<string, { x: number; y: number }>
): ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    data: node.data,
    position: node.position ?? positions?.[node.id] ?? { x: 0, y: 0 },
  }));
}

export function toReactFlowEdges(
  graph: WorkflowGraph
): ReactFlowEdge<ReactFlowWorkflowEdgeData>[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.source_handle,
    target: edge.target,
    targetHandle: edge.target_handle,
    type: WORKFLOW_REACT_FLOW_EDGE_TYPE,
    data: { workflowType: edge.type },
    label: getWorkflowEdgeLabel(edge.type),
  }));
}

function getWorkflowTypeFromReactFlowEdge(
  edge: ReactFlowEdge
): WorkflowEdgeKind {
  const data = edge.data as Partial<ReactFlowWorkflowEdgeData> | undefined;
  if (isWorkflowEdgeKind(data?.workflowType)) {
    return data.workflowType;
  }
  if (isWorkflowEdgeKind(edge.type)) {
    return edge.type;
  }
  return 'default';
}

export function fromReactFlowGraph(
  nodes: ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>[],
  edges: ReactFlowEdge[]
): WorkflowGraph {
  return {
    version: WORKFLOW_GRAPH_VERSION,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      data: stripWorkflowNodeUiData(node.data),
      position: node.position,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      source_handle: edge.sourceHandle ?? undefined,
      target: edge.target,
      target_handle: edge.targetHandle ?? undefined,
      type: getWorkflowTypeFromReactFlowEdge(edge),
    })),
  };
}

function stripWorkflowNodeUiData(data: WorkflowNodeData): WorkflowNodeData {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !key.startsWith('__'))
  ) as WorkflowNodeData;
}
