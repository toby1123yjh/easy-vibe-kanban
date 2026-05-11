import type {
  Node as ReactFlowNode,
  Edge as ReactFlowEdge,
} from '@xyflow/react';
import { createDefaultNodeData } from './workflowNodeCatalog';
import { getWorkflowEdgeLabel } from './workflowPresentation';

export const WORKFLOW_GRAPH_VERSION = 1;

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
  target: string;
  type: WorkflowEdgeKind;
}

export interface WorkflowGraph {
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowNodePosition {
  x: number;
  y: number;
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
        target: 'end',
        type: 'default',
      },
    ],
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
  target: string;
  type?: WorkflowEdgeKind;
}): WorkflowEdge {
  return {
    id: options.id ?? `${options.source}-${options.target}`,
    source: options.source,
    target: options.target,
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

export function toReactFlowEdges(graph: WorkflowGraph): ReactFlowEdge[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: edge.type,
    label: getWorkflowEdgeLabel(edge.type),
  }));
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
      data: node.data,
      position: node.position,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: (edge.type as WorkflowEdgeKind) ?? 'default',
    })),
  };
}
