import type {
  Node as ReactFlowNode,
  Edge as ReactFlowEdge,
} from '@xyflow/react';
import { createDefaultNodeData } from './workflowNodeCatalog';
import { getWorkflowEdgeLabel } from './workflowPresentation';

export const WORKFLOW_GRAPH_VERSION = 2;
export const WORKFLOW_PORT_HANDLE_IDS = {
  left: 'port-left',
  top: 'port-top',
  right: 'port-right',
  bottom: 'port-bottom',
} as const;
export const DEFAULT_SOURCE_HANDLE = WORKFLOW_PORT_HANDLE_IDS.right;
export const DEFAULT_TARGET_HANDLE = WORKFLOW_PORT_HANDLE_IDS.left;

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
  session_id?: string;
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

export type WorkflowCanvasObjectKind = 'sticky_note' | 'stage_group';
export type WorkflowCanvasObjectColor = 'amber' | 'blue' | 'green' | 'neutral';

export interface WorkflowCanvasObjectSize {
  width: number;
  height: number;
}

export interface WorkflowCanvasStickyNote {
  id: string;
  type: 'sticky_note';
  title?: string;
  content: string;
  position: WorkflowNodePosition;
  size: WorkflowCanvasObjectSize;
  color?: WorkflowCanvasObjectColor;
}

export interface WorkflowCanvasStageGroup {
  id: string;
  type: 'stage_group';
  title: string;
  description?: string;
  position: WorkflowNodePosition;
  size: WorkflowCanvasObjectSize;
  color?: WorkflowCanvasObjectColor;
}

export interface WorkflowCanvasData {
  notes?: WorkflowCanvasStickyNote[];
  groups?: WorkflowCanvasStageGroup[];
}

export interface WorkflowGraph {
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  canvas?: WorkflowCanvasData;
}

export interface WorkflowCanvasObjectNodeData extends Record<string, unknown> {
  title?: string;
  content?: string;
  description?: string;
  color?: WorkflowCanvasObjectColor;
  size?: WorkflowCanvasObjectSize;
}

export type WorkflowCanvasReactFlowNodeKind =
  | WorkflowNodeKind
  | WorkflowCanvasObjectKind;
export type WorkflowCanvasReactFlowNodeData =
  | WorkflowNodeData
  | WorkflowCanvasObjectNodeData;

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

const DEFAULT_WORKFLOW_LAYOUT = {
  start: { x: 120, y: 190 },
  agent: { x: 420, y: 160 },
  end: { x: 780, y: 190 },
} as const satisfies Record<string, WorkflowNodePosition>;

const DEFAULT_AGENT_PROMPT =
  '熟悉当前项目结构、关键模块和任务背景，输出你的理解、风险点和下一步实施方案。';

const DEFAULT_NOTE_SIZE: WorkflowCanvasObjectSize = {
  width: 280,
  height: 150,
};

const DEFAULT_GROUP_SIZE: WorkflowCanvasObjectSize = {
  width: 880,
  height: 240,
};

export function normalizeWorkflowPortHandle(
  handle: string | null | undefined,
  fallback: string
): string {
  switch (handle) {
    case 'input-left':
    case 'output-left':
      return WORKFLOW_PORT_HANDLE_IDS.left;
    case 'input-top':
    case 'output-top':
      return WORKFLOW_PORT_HANDLE_IDS.top;
    case 'input-right':
    case 'output-right':
      return WORKFLOW_PORT_HANDLE_IDS.right;
    case 'input-bottom':
    case 'output-bottom':
      return WORKFLOW_PORT_HANDLE_IDS.bottom;
    default:
      return handle ?? fallback;
  }
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
        position: DEFAULT_WORKFLOW_LAYOUT.start,
      },
      {
        id: 'familiarize',
        type: 'agent',
        data: {
          display_name: '熟悉项目',
          role_template_id: 'custom',
          prompt_template: DEFAULT_AGENT_PROMPT,
        },
        position: DEFAULT_WORKFLOW_LAYOUT.agent,
      },
      {
        id: 'end',
        type: 'end',
        data: { display_name: 'End' },
        position: DEFAULT_WORKFLOW_LAYOUT.end,
      },
    ],
    edges: [
      {
        id: 'start-familiarize',
        source: 'start',
        source_handle: DEFAULT_SOURCE_HANDLE,
        target: 'familiarize',
        target_handle: DEFAULT_TARGET_HANDLE,
        type: 'default',
      },
      {
        id: 'familiarize-end',
        source: 'familiarize',
        source_handle: DEFAULT_SOURCE_HANDLE,
        target: 'end',
        target_handle: DEFAULT_TARGET_HANDLE,
        type: 'default',
      },
    ],
    canvas: {
      groups: [
        {
          id: 'stage-understand',
          type: 'stage_group',
          title: '阶段 1：理解项目',
          description:
            '默认从熟悉项目开始，后续可以继续添加实现、评审、测试节点。',
          position: { x: 70, y: 105 },
          size: DEFAULT_GROUP_SIZE,
          color: 'neutral',
        },
      ],
    },
  };
}

export function migrateWorkflowGraph(
  graph: WorkflowGraph | LegacyWorkflowGraph
): WorkflowGraph {
  const canvas = normalizeWorkflowCanvas(graph.canvas);
  const { canvas: _canvas, ...graphWithoutCanvas } = graph;
  return {
    ...graphWithoutCanvas,
    version: WORKFLOW_GRAPH_VERSION,
    nodes: graph.nodes.map((node, index) => ({
      ...node,
      position: node.position ?? fallbackWorkflowNodePosition(index),
    })),
    edges: graph.edges.map((edge) => ({
      ...edge,
      source_handle: normalizeWorkflowPortHandle(
        edge.source_handle,
        DEFAULT_SOURCE_HANDLE
      ),
      target_handle: normalizeWorkflowPortHandle(
        edge.target_handle,
        DEFAULT_TARGET_HANDLE
      ),
    })),
    ...(canvas ? { canvas } : {}),
  };
}

function fallbackWorkflowNodePosition(index: number): WorkflowNodePosition {
  return {
    x: 120 + (index % 4) * 360,
    y: 160 + Math.floor(index / 4) * 190,
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

export function createWorkflowCanvasStickyNote(options?: {
  id?: string;
  title?: string;
  content?: string;
  position?: WorkflowNodePosition;
  size?: WorkflowCanvasObjectSize;
  color?: WorkflowCanvasObjectColor;
}): WorkflowCanvasStickyNote {
  return {
    id: options?.id ?? `note-${crypto.randomUUID().slice(0, 8)}`,
    type: 'sticky_note',
    title: options?.title ?? 'Note',
    content: options?.content ?? '',
    position: options?.position ?? { x: 160, y: 80 },
    size: options?.size ?? DEFAULT_NOTE_SIZE,
    color: options?.color ?? 'amber',
  };
}

export function createWorkflowCanvasStageGroup(options?: {
  id?: string;
  title?: string;
  description?: string;
  position?: WorkflowNodePosition;
  size?: WorkflowCanvasObjectSize;
  color?: WorkflowCanvasObjectColor;
}): WorkflowCanvasStageGroup {
  return {
    id: options?.id ?? `stage-${crypto.randomUUID().slice(0, 8)}`,
    type: 'stage_group',
    title: options?.title ?? 'Stage',
    description: options?.description ?? '',
    position: options?.position ?? { x: 80, y: 120 },
    size: options?.size ?? DEFAULT_GROUP_SIZE,
    color: options?.color ?? 'neutral',
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

export function toReactFlowCanvasNodes(
  graph: WorkflowGraph,
  positions?: Record<string, { x: number; y: number }>
): ReactFlowNode<
  WorkflowCanvasReactFlowNodeData,
  WorkflowCanvasReactFlowNodeKind
>[] {
  const groups = (graph.canvas?.groups ?? []).map((group) => ({
    id: group.id,
    type: 'stage_group' as const,
    data: {
      title: group.title,
      description: group.description,
      color: group.color,
      size: group.size,
    },
    position: group.position,
    style: {
      width: group.size.width,
      height: group.size.height,
    },
    zIndex: -1,
  }));

  const notes = (graph.canvas?.notes ?? []).map((note) => ({
    id: note.id,
    type: 'sticky_note' as const,
    data: {
      title: note.title,
      content: note.content,
      color: note.color,
      size: note.size,
    },
    position: note.position,
    style: {
      width: note.size.width,
      height: note.size.height,
    },
    zIndex: 2,
  }));

  return [
    ...groups,
    ...toReactFlowNodes(graph, positions),
    ...notes,
  ] satisfies ReactFlowNode<
    WorkflowCanvasReactFlowNodeData,
    WorkflowCanvasReactFlowNodeKind
  >[];
}

export function toReactFlowEdges(
  graph: WorkflowGraph
): ReactFlowEdge<ReactFlowWorkflowEdgeData>[] {
  return graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: normalizeWorkflowPortHandle(
      edge.source_handle,
      DEFAULT_SOURCE_HANDLE
    ),
    target: edge.target,
    targetHandle: normalizeWorkflowPortHandle(
      edge.target_handle,
      DEFAULT_TARGET_HANDLE
    ),
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
  edges: ReactFlowEdge[],
  baseGraph?: WorkflowGraph
): WorkflowGraph {
  const canvas = normalizeWorkflowCanvas(baseGraph?.canvas);
  const { canvas: _canvas, ...baseGraphWithoutCanvas } = baseGraph ?? {};
  return {
    ...baseGraphWithoutCanvas,
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
      source_handle: normalizeWorkflowPortHandle(
        edge.sourceHandle,
        DEFAULT_SOURCE_HANDLE
      ),
      target: edge.target,
      target_handle: normalizeWorkflowPortHandle(
        edge.targetHandle,
        DEFAULT_TARGET_HANDLE
      ),
      type: getWorkflowTypeFromReactFlowEdge(edge),
    })),
    ...(canvas ? { canvas } : {}),
  };
}

export function fromReactFlowCanvasGraph(
  nodes: ReactFlowNode<
    WorkflowCanvasReactFlowNodeData,
    WorkflowCanvasReactFlowNodeKind
  >[],
  edges: ReactFlowEdge[],
  baseGraph?: WorkflowGraph
): WorkflowGraph {
  const workflowNodes: ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>[] = [];
  const notes: WorkflowCanvasStickyNote[] = [];
  const groups: WorkflowCanvasStageGroup[] = [];

  for (const node of nodes) {
    if (isWorkflowNodeKind(String(node.type))) {
      workflowNodes.push(
        node as ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>
      );
      continue;
    }

    if (node.type === 'sticky_note') {
      const data = stripWorkflowCanvasObjectUiData(node.data);
      notes.push({
        id: node.id,
        type: 'sticky_note',
        title: typeof data.title === 'string' ? data.title : undefined,
        content: typeof data.content === 'string' ? data.content : '',
        position: node.position,
        size: getCanvasNodeSize(node, DEFAULT_NOTE_SIZE),
        color: normalizeWorkflowCanvasObjectColor(data.color),
      });
      continue;
    }

    if (node.type === 'stage_group') {
      const data = stripWorkflowCanvasObjectUiData(node.data);
      groups.push({
        id: node.id,
        type: 'stage_group',
        title: typeof data.title === 'string' ? data.title : 'Stage',
        description:
          typeof data.description === 'string' ? data.description : undefined,
        position: node.position,
        size: getCanvasNodeSize(node, DEFAULT_GROUP_SIZE),
        color: normalizeWorkflowCanvasObjectColor(data.color),
      });
    }
  }

  const graph = fromReactFlowGraph(workflowNodes, edges, baseGraph);
  const canvas = normalizeWorkflowCanvas({ notes, groups });
  if (!canvas) {
    const next = { ...graph };
    delete next.canvas;
    return next;
  }
  return { ...graph, canvas };
}

function stripWorkflowNodeUiData(data: WorkflowNodeData): WorkflowNodeData {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !key.startsWith('__'))
  ) as WorkflowNodeData;
}

function stripWorkflowCanvasObjectUiData(
  data: WorkflowCanvasReactFlowNodeData
): WorkflowCanvasObjectNodeData {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !key.startsWith('__'))
  ) as WorkflowCanvasObjectNodeData;
}

function normalizeWorkflowCanvas(
  canvas: WorkflowCanvasData | undefined
): WorkflowCanvasData | undefined {
  const notes = (canvas?.notes ?? []).map((note) => ({
    ...note,
    type: 'sticky_note' as const,
    content: note.content ?? '',
    position: note.position ?? { x: 160, y: 80 },
    size: normalizeCanvasSize(note.size, DEFAULT_NOTE_SIZE),
    color: normalizeWorkflowCanvasObjectColor(note.color),
  }));
  const groups = (canvas?.groups ?? []).map((group) => ({
    ...group,
    type: 'stage_group' as const,
    title: group.title || 'Stage',
    description: group.description ?? '',
    position: group.position ?? { x: 80, y: 120 },
    size: normalizeCanvasSize(group.size, DEFAULT_GROUP_SIZE),
    color: normalizeWorkflowCanvasObjectColor(group.color),
  }));

  if (notes.length === 0 && groups.length === 0) return undefined;
  return {
    ...(notes.length > 0 ? { notes } : {}),
    ...(groups.length > 0 ? { groups } : {}),
  };
}

function normalizeCanvasSize(
  size: Partial<WorkflowCanvasObjectSize> | undefined,
  fallback: WorkflowCanvasObjectSize
): WorkflowCanvasObjectSize {
  return {
    width:
      typeof size?.width === 'number' && Number.isFinite(size.width)
        ? size.width
        : fallback.width,
    height:
      typeof size?.height === 'number' && Number.isFinite(size.height)
        ? size.height
        : fallback.height,
  };
}

function normalizeWorkflowCanvasObjectColor(
  color: unknown
): WorkflowCanvasObjectColor | undefined {
  return color === 'amber' ||
    color === 'blue' ||
    color === 'green' ||
    color === 'neutral'
    ? color
    : undefined;
}

function getCanvasNodeSize(
  node: ReactFlowNode<
    WorkflowCanvasReactFlowNodeData,
    WorkflowCanvasReactFlowNodeKind
  >,
  fallback: WorkflowCanvasObjectSize
): WorkflowCanvasObjectSize {
  const dataSize =
    'size' in node.data ? (node.data.size as WorkflowCanvasObjectSize) : null;
  return normalizeCanvasSize(
    {
      width:
        node.width ??
        parseCanvasDimension(node.style?.width) ??
        dataSize?.width,
      height:
        node.height ??
        parseCanvasDimension(node.style?.height) ??
        dataSize?.height,
    },
    fallback
  );
}

function parseCanvasDimension(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function tidyWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
  const levels = getWorkflowNodeLevels(graph);
  const buckets = new Map<number, WorkflowNode[]>();

  for (const node of graph.nodes) {
    const level = levels.get(node.id) ?? 0;
    const bucket = buckets.get(level) ?? [];
    bucket.push(node);
    buckets.set(level, bucket);
  }

  const positions = new Map<string, WorkflowNodePosition>();
  const sortedLevels = Array.from(buckets.keys()).sort((a, b) => a - b);
  for (const level of sortedLevels) {
    const bucket = [...(buckets.get(level) ?? [])].sort((a, b) => {
      const ay = a.position?.y ?? 0;
      const by = b.position?.y ?? 0;
      if (ay !== by) return ay - by;
      return (a.position?.x ?? 0) - (b.position?.x ?? 0);
    });
    const startY = 170 - ((bucket.length - 1) * 190) / 2;
    bucket.forEach((node, index) => {
      positions.set(node.id, {
        x: 120 + level * 360,
        y: Math.max(80, startY + index * 190),
      });
    });
  }

  const nodes = graph.nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
  const edges = graph.edges.map((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return edge;
    return {
      ...edge,
      ...getDirectionalEdgeHandles(source, target),
    };
  });

  return { ...graph, nodes, edges };
}

function getWorkflowNodeLevels(graph: WorkflowGraph): Map<string, number> {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const outgoing = new Map<string, WorkflowEdge[]>();
  const incomingTargets = new Set<string>();

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    const sourceEdges = outgoing.get(edge.source) ?? [];
    sourceEdges.push(edge);
    outgoing.set(edge.source, sourceEdges);
    incomingTargets.add(edge.target);
  }

  const starts = graph.nodes.filter(
    (node) => node.type === 'start' || !incomingTargets.has(node.id)
  );
  const levels = new Map<string, number>();
  const queue = starts.length > 0 ? starts.map((node) => node.id) : [];

  for (const start of queue) {
    levels.set(start, 0);
  }

  let guard = graph.nodes.length * Math.max(graph.edges.length, 1);
  while (queue.length > 0 && guard > 0) {
    guard -= 1;
    const sourceId = queue.shift();
    if (!sourceId) continue;
    const sourceLevel = levels.get(sourceId) ?? 0;
    for (const edge of outgoing.get(sourceId) ?? []) {
      const nextLevel = Math.min(sourceLevel + 1, graph.nodes.length);
      if ((levels.get(edge.target) ?? -1) >= nextLevel) continue;
      levels.set(edge.target, nextLevel);
      queue.push(edge.target);
    }
  }

  const fallbackLevel =
    Math.max(0, ...Array.from(levels.values())) + (levels.size > 0 ? 1 : 0);
  graph.nodes.forEach((node, index) => {
    if (!levels.has(node.id)) {
      levels.set(node.id, fallbackLevel + index);
    }
  });

  return levels;
}

function getDirectionalEdgeHandles(
  source: WorkflowNodePosition,
  target: WorkflowNodePosition
): Pick<WorkflowEdge, 'source_handle' | 'target_handle'> {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? {
          source_handle: WORKFLOW_PORT_HANDLE_IDS.right,
          target_handle: WORKFLOW_PORT_HANDLE_IDS.left,
        }
      : {
          source_handle: WORKFLOW_PORT_HANDLE_IDS.left,
          target_handle: WORKFLOW_PORT_HANDLE_IDS.right,
        };
  }
  return dy >= 0
    ? {
        source_handle: WORKFLOW_PORT_HANDLE_IDS.bottom,
        target_handle: WORKFLOW_PORT_HANDLE_IDS.top,
      }
    : {
        source_handle: WORKFLOW_PORT_HANDLE_IDS.top,
        target_handle: WORKFLOW_PORT_HANDLE_IDS.bottom,
      };
}
