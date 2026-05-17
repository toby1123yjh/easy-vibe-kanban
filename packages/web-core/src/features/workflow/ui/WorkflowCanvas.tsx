import {
  useCallback,
  useEffect,
  useRef,
  type DragEvent,
  type MouseEvent,
} from 'react';
import {
  ReactFlow,
  BaseEdge,
  Background,
  BackgroundVariant,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  ConnectionLineType,
  ConnectionMode,
  useNodesState,
  useEdgesState,
  addEdge,
  reconnectEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  getSmoothStepPath,
  type Connection,
  type Edge as ReactFlowEdge,
  type Node as ReactFlowNode,
  type NodeChange,
  type EdgeChange,
  type EdgeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  DEFAULT_SOURCE_HANDLE,
  DEFAULT_TARGET_HANDLE,
  WORKFLOW_PORT_HANDLE_IDS,
  normalizeWorkflowPortHandle,
  toReactFlowNodes,
  toReactFlowEdges,
  fromReactFlowGraph,
  isWorkflowNodeKind,
  WORKFLOW_REACT_FLOW_EDGE_TYPE,
  type WorkflowGraph,
  type WorkflowNodeKind,
  type WorkflowNodeData,
  type WorkflowNodePosition,
  type ReactFlowWorkflowEdgeData,
  WORKFLOW_NODE_DRAG_DATA_TYPE,
} from '../model/workflowGraph';
import {
  getWorkflowEdgeVisual,
  getWorkflowNodeMetadata,
  getWorkflowNodeKindLabel,
  getWorkflowNodeRouteHints,
  getWorkflowNodeSummary,
  getWorkflowNodeVisual,
} from '../model/workflowPresentation';
import { getWorkflowNodeIcon } from './workflowNodeIcons';
import type { ValidationIssue } from './WorkflowValidationPanel';
import { cn } from '../../../shared/lib/utils';

export interface WorkflowCanvasProps {
  graph: WorkflowGraph;
  validationIssues?: ValidationIssue[];
  readOnly?: boolean;
  onChange?: (graph: WorkflowGraph) => void;
  onSelectionChange?: (selection: WorkflowCanvasSelection) => void;
  onNodeDrop?: (kind: WorkflowNodeKind, position: WorkflowNodePosition) => void;
  onNodeOpen?: (nodeId: string) => void;
  onNodeContextMenu?: (event: WorkflowNodeContextMenuEvent) => void;
}

export interface WorkflowCanvasSelection {
  nodeId: string | null;
  edgeId: string | null;
}

export interface WorkflowNodeContextMenuEvent {
  nodeId: string;
  x: number;
  y: number;
}

interface WorkflowCanvasEdgeData extends ReactFlowWorkflowEdgeData {
  onSelect?: (edgeId: string) => void;
}

interface BaseNodeProps {
  id: string;
  data: WorkflowNodeData;
  type?: WorkflowNodeKind;
  selected?: boolean;
}

const ROUTE_HINT_CLASSES: Record<string, string> = {
  brand: 'border-brand/30 bg-brand/10 text-brand',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  danger: 'border-error/30 bg-error/10 text-error',
};

const getValidationIssues = (data: WorkflowNodeData): ValidationIssue[] => {
  const issues = data.__validationIssues;
  return Array.isArray(issues) ? (issues as ValidationIssue[]) : [];
};

const getExecutorLabel = (data: WorkflowNodeData): string => {
  const config = data.executor_config;
  if (!config || typeof config !== 'object') return 'Agent';
  const executor = (config as { executor?: unknown }).executor;
  if (typeof executor !== 'string' || executor.length === 0) return 'Agent';
  return executor.replace(/_/g, ' ');
};

const hasSession = (data: WorkflowNodeData): boolean =>
  typeof data.session_id === 'string' && data.session_id.length > 0;

const workflowHandleClass =
  'h-4 w-4 border-[3px] border-[#15171d] bg-brand/80 shadow-[0_0_0_1px_rgba(255,255,255,0.18),0_0_12px_rgba(249,115,22,0.34)] transition-colors hover:bg-brand';

const workflowHandlePoints = [
  {
    id: WORKFLOW_PORT_HANDLE_IDS.left,
    position: Position.Left,
    style: { top: '50%' },
  },
  {
    id: WORKFLOW_PORT_HANDLE_IDS.top,
    position: Position.Top,
    style: { left: '50%' },
  },
  {
    id: WORKFLOW_PORT_HANDLE_IDS.right,
    position: Position.Right,
    style: { top: '50%' },
  },
  {
    id: WORKFLOW_PORT_HANDLE_IDS.bottom,
    position: Position.Bottom,
    style: { left: '50%' },
  },
] as const;

function renderWorkflowHandles({
  canReceive,
  canStart,
}: {
  canReceive: boolean;
  canStart: boolean;
}) {
  if (!canReceive && !canStart) {
    return null;
  }

  return workflowHandlePoints.map((handle) => {
    return (
      <Handle
        key={handle.id}
        id={handle.id}
        type={canStart ? 'source' : 'target'}
        position={handle.position}
        style={handle.style}
        className={cn(workflowHandleClass, 'workflow-handle-visible z-[3]')}
      />
    );
  });
}

const BaseNode = ({ id, data, type, selected }: BaseNodeProps) => {
  const nodeKind = type ?? 'agent';
  const Icon = getWorkflowNodeIcon(nodeKind);
  const visual = getWorkflowNodeVisual(nodeKind);
  const metadata = getWorkflowNodeMetadata(nodeKind, data);
  const routeHints = getWorkflowNodeRouteHints(nodeKind, data);
  const validationIssues = getValidationIssues(data);
  const issueCount = validationIssues.length;
  const structural = nodeKind === 'start' || nodeKind === 'end';
  const compactAgent = nodeKind === 'agent';
  const sessionReady = hasSession(data);

  if (structural) {
    return (
      <div
        data-testid={`workflow-node-${id}`}
        style={{ pointerEvents: 'all' }}
        className={cn(
          'relative flex min-w-[150px] cursor-grab items-center gap-2 overflow-visible rounded-full border bg-[#15171d]/90 px-3 py-2 text-high shadow-[0_10px_28px_rgba(0,0,0,0.28)] backdrop-blur transition-all duration-150 active:cursor-grabbing',
          selected
            ? 'border-brand ring-2 ring-brand/30'
            : issueCount > 0
              ? 'border-amber-500/70'
              : 'border-white/12 hover:border-brand/60'
        )}
      >
        {renderWorkflowHandles({
          canReceive: nodeKind !== 'start',
          canStart: nodeKind !== 'end',
        })}
        {issueCount > 0 ? (
          <div
            data-testid={`workflow-node-issue-${id}`}
            title={validationIssues.map((issue) => issue.message).join('\n')}
            className="absolute -right-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-[#15171d] bg-amber-500 px-1 text-[10px] font-semibold text-white shadow-sm"
          >
            {issueCount}
          </div>
        ) : null}
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10',
            visual.iconClass
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            {data.display_name || getWorkflowNodeKindLabel(nodeKind)}
          </div>
          <div
            data-testid={`workflow-node-kind-${id}`}
            className="text-[10px] font-semibold uppercase tracking-normal text-low"
          >
            {getWorkflowNodeKindLabel(nodeKind)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={`workflow-node-${id}`}
      style={{ pointerEvents: 'all' }}
      className={cn(
        'workflow-agent-step-node relative min-w-[236px] max-w-[280px] cursor-grab overflow-visible rounded-lg border bg-[#17191f]/95 text-high shadow-[0_18px_48px_rgba(0,0,0,0.32)] backdrop-blur transition-all duration-150 active:cursor-grabbing',
        selected
          ? 'border-brand shadow-[0_20px_54px_rgba(249,115,22,0.18)] ring-2 ring-brand/25'
          : issueCount > 0
            ? 'border-amber-500/70 shadow-amber-500/10 hover:border-amber-500'
            : 'border-white/12 hover:border-brand/60 hover:shadow-[0_20px_54px_rgba(0,0,0,0.38)]'
      )}
    >
      {renderWorkflowHandles({
        canReceive: type !== 'start',
        canStart: type !== 'end',
      })}

      <div
        className={cn(
          'absolute inset-y-0 left-0 w-1 rounded-l-lg',
          visual.accentClass
        )}
      />

      {issueCount > 0 ? (
        <div
          data-testid={`workflow-node-issue-${id}`}
          title={validationIssues.map((issue) => issue.message).join('\n')}
          className="absolute -right-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-[#17191f] bg-amber-500 px-1 text-[10px] font-semibold text-white shadow-sm"
        >
          {issueCount}
        </div>
      ) : null}

      <div className="flex items-start gap-3 border-b border-white/10 bg-white/[0.03] px-3 py-2 pl-4">
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10',
            visual.iconClass
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-high">
            {data.display_name || type || 'Node'}
          </div>
          <div
            data-testid={`workflow-node-kind-${id}`}
            className="mt-0.5 text-[10px] font-semibold uppercase tracking-normal text-low"
          >
            {nodeKind === 'agent'
              ? getExecutorLabel(data)
              : getWorkflowNodeKindLabel(nodeKind)}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2 pl-4 text-xs text-low">
        {!compactAgent ? (
          <div
            data-testid={`workflow-node-summary-${id}`}
            className="truncate text-normal"
          >
            {getWorkflowNodeSummary(nodeKind, data)}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1">
          <span
            data-testid={`workflow-node-session-${id}`}
            className={cn(
              'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none',
              sessionReady
                ? 'border-success/30 bg-success/10 text-success'
                : 'border-white/10 bg-white/[0.04] text-low'
            )}
          >
            {sessionReady ? 'Session ready' : 'Draft session'}
          </span>
          <span className="inline-flex items-center rounded border border-brand/25 bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-brand">
            {compactAgent ? 'Agent Step' : getWorkflowNodeKindLabel(nodeKind)}
          </span>
        </div>

        {!compactAgent && metadata.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {metadata.map((chip) => (
              <span
                key={`${chip.label}-${chip.value}`}
                data-testid={`workflow-node-metadata-${id}-${chip.label}`}
                className={cn(
                  'inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] leading-none',
                  visual.badgeClass
                )}
              >
                <span>{chip.label}</span>{' '}
                <span className="font-semibold">{chip.value}</span>
              </span>
            ))}
          </div>
        ) : null}

        {!compactAgent && routeHints.length > 0 ? (
          <div className="flex flex-wrap gap-1 border-t border-secondary/50 pt-2">
            {routeHints.map((hint) => (
              <span
                key={`${hint.label}-${hint.tone}`}
                data-testid={`workflow-node-route-${id}-${hint.label}`}
                className={cn(
                  'rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none',
                  ROUTE_HINT_CLASSES[hint.tone]
                )}
              >
                {hint.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
};

const nodeTypes = {
  start: BaseNode,
  end: BaseNode,
  agent: BaseNode,
  condition: BaseNode,
  human_gate: BaseNode,
  transform: BaseNode,
  arena: BaseNode,
};

export const WORKFLOW_CANVAS_SNAP_GRID: [number, number] = [15, 15];
export const WORKFLOW_CANVAS_DELETE_KEYS = ['Backspace', 'Delete'];
export const WORKFLOW_CANVAS_EDGE_TYPE = WORKFLOW_REACT_FLOW_EDGE_TYPE;
export const WORKFLOW_CANVAS_CONNECTION_LINE_TYPE =
  ConnectionLineType.SmoothStep;
export const WORKFLOW_CANVAS_CONNECTION_MODE = ConnectionMode.Loose;
export const WORKFLOW_CANVAS_MINIMAP_BACKGROUND = '#15171d';
export const WORKFLOW_CANVAS_READ_ONLY_NODE_CHANGE_TYPES = [
  'select',
  'dimensions',
  'position',
] as const;
export const WORKFLOW_CANVAS_READ_ONLY_EDGE_CHANGE_TYPES = ['select'] as const;
const EMPTY_VALIDATION_ISSUES: ValidationIssue[] = [];

type ReadOnlyNodeChangeType =
  (typeof WORKFLOW_CANVAS_READ_ONLY_NODE_CHANGE_TYPES)[number];
type ReadOnlyEdgeChangeType =
  (typeof WORKFLOW_CANVAS_READ_ONLY_EDGE_CHANGE_TYPES)[number];

export function filterReadOnlyNodeChanges<
  TNode extends ReactFlowNode = ReactFlowNode,
>(changes: NodeChange<TNode>[]): NodeChange<TNode>[] {
  return changes.filter((change) =>
    (WORKFLOW_CANVAS_READ_ONLY_NODE_CHANGE_TYPES as readonly string[]).includes(
      change.type as ReadOnlyNodeChangeType
    )
  );
}

export function filterReadOnlyEdgeChanges<
  TEdge extends ReactFlowEdge = ReactFlowEdge,
>(changes: EdgeChange<TEdge>[]): EdgeChange<TEdge>[] {
  return changes.filter((change) =>
    (WORKFLOW_CANVAS_READ_ONLY_EDGE_CHANGE_TYPES as readonly string[]).includes(
      change.type as ReadOnlyEdgeChangeType
    )
  );
}

const WorkflowEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  selected,
}: EdgeProps<ReactFlowEdge<WorkflowCanvasEdgeData>>) => {
  const workflowType = data?.workflowType ?? 'default';
  const onSelect = data?.onSelect;
  const visual = getWorkflowEdgeVisual(workflowType);
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 18,
  });

  return (
    <>
      <g data-testid={`workflow-edge-${id}`} className="group">
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={markerEnd}
          interactionWidth={32}
          className={cn('workflow-edge-path transition-all', visual.pathClass)}
          style={{ strokeWidth: selected ? 3 : 2, opacity: 0.78 }}
        />
        <BaseEdge
          id={`${id}-beam`}
          path={edgePath}
          interactionWidth={0}
          className={cn(
            'workflow-edge-beam opacity-40 transition-opacity group-hover:opacity-80',
            selected && 'opacity-90'
          )}
          style={{ strokeWidth: selected ? 3 : 2 }}
        />
        {onSelect ? (
          <foreignObject
            x={labelX - 12}
            y={labelY - 12}
            width={24}
            height={24}
            className={cn(
              'workflow-edge-action overflow-visible opacity-0 transition-opacity group-hover:opacity-100',
              selected && 'opacity-100'
            )}
          >
            <button
              type="button"
              data-testid={`workflow-edge-action-${id}`}
              className="nodrag nopan flex h-6 w-6 items-center justify-center rounded-full border border-brand/50 bg-[#17191f] text-brand shadow-[0_0_18px_rgba(249,115,22,0.32)] transition-colors hover:border-brand hover:bg-brand hover:text-white"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(id);
              }}
              aria-label={`Select edge ${id}`}
            >
              <span className="h-2 w-2 rounded-full bg-current" />
            </button>
          </foreignObject>
        ) : null}
      </g>
      {visual.label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
            }}
          >
            <span
              data-testid={`workflow-edge-chip-${id}`}
              className={cn(
                'rounded border px-2 py-0.5 text-[10px] font-semibold shadow-sm',
                visual.chipClass
              )}
            >
              {visual.label}
            </span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
};

const edgeTypes = {
  [WORKFLOW_CANVAS_EDGE_TYPE]: WorkflowEdge,
};

const GRAPH_AFFECTING_NODE_CHANGE_TYPES = new Set([
  'add',
  'remove',
  'replace',
  'position',
]);

const GRAPH_AFFECTING_EDGE_CHANGE_TYPES = new Set(['add', 'remove', 'replace']);

export function hasGraphAffectingNodeChanges(
  changes: Array<{ type: string }>
): boolean {
  return changes.some((change) =>
    GRAPH_AFFECTING_NODE_CHANGE_TYPES.has(change.type)
  );
}

export function hasGraphAffectingEdgeChanges(
  changes: Array<{ type: string }>
): boolean {
  return changes.some((change) =>
    GRAPH_AFFECTING_EDGE_CHANGE_TYPES.has(change.type)
  );
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return (
    target.isContentEditable ||
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select'
  );
}

export function WorkflowCanvas({
  graph,
  validationIssues = EMPTY_VALIDATION_ISSUES,
  readOnly = false,
  onChange,
  onSelectionChange,
  onNodeDrop,
  onNodeOpen,
  onNodeContextMenu,
}: WorkflowCanvasProps) {
  const [nodes, setNodes] = useNodesState<
    ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>
  >([]);
  const [edges, setEdges] = useEdgesState<
    ReactFlowEdge<WorkflowCanvasEdgeData>
  >([]);
  const { screenToFlowPosition } = useReactFlow();
  const lastSelectionRef = useRef<WorkflowCanvasSelection>({
    nodeId: null,
    edgeId: null,
  });
  const nodesRef = useRef<ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>[]>(
    []
  );
  const edgesRef = useRef<ReactFlowEdge<WorkflowCanvasEdgeData>[]>([]);
  const selectEdgeRef = useRef<(edgeId: string) => void>(() => {});

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  // Sync incoming graph to internal state
  useEffect(() => {
    const issuesByNodeId = new Map<string, ValidationIssue[]>();
    for (const issue of validationIssues) {
      if (!issue.nodeId) continue;
      const nodeIssues = issuesByNodeId.get(issue.nodeId) ?? [];
      nodeIssues.push(issue);
      issuesByNodeId.set(issue.nodeId, nodeIssues);
    }

    setNodes((currentNodes) => {
      const positionMap = new Map(currentNodes.map((n) => [n.id, n.position]));
      const fallbackPositions = Object.fromEntries(
        graph.nodes.map((node, index) => [
          node.id,
          {
            x: 80 + (index % 4) * 340,
            y: 80 + Math.floor(index / 4) * 150,
          },
        ])
      );
      const nextNodes = toReactFlowNodes(graph, fallbackPositions).map((n) => ({
        ...n,
        data: {
          ...n.data,
          __validationIssues: issuesByNodeId.get(n.id) ?? [],
        },
        position: positionMap.get(n.id) ?? n.position,
      }));
      nodesRef.current = nextNodes;
      return nextNodes;
    });
    const nextEdges = toReactFlowEdges(graph).map((edge) => ({
      ...edge,
      data: {
        workflowType: edge.data?.workflowType ?? 'default',
        onSelect: (edgeId: string) => selectEdgeRef.current(edgeId),
      },
    })) satisfies ReactFlowEdge<WorkflowCanvasEdgeData>[];
    edgesRef.current = nextEdges;
    setEdges(nextEdges);
  }, [graph, setNodes, setEdges, validationIssues]);

  // Bubble up changes
  const reportChange = useCallback(
    (
      newNodes: ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>[],
      newEdges: ReactFlowEdge<WorkflowCanvasEdgeData>[]
    ) => {
      if (readOnly || !onChange) return;
      onChange(fromReactFlowGraph(newNodes, newEdges));
    },
    [readOnly, onChange]
  );

  const onNodesChange = useCallback(
    (
      changes: NodeChange<ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>>[]
    ) => {
      const appliedChanges = readOnly
        ? filterReadOnlyNodeChanges(changes)
        : changes;
      if (appliedChanges.length === 0) return;
      const next = applyNodeChanges(
        appliedChanges,
        nodesRef.current
      ) as ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>[];
      nodesRef.current = next;
      setNodes(next);
      if (!readOnly && hasGraphAffectingNodeChanges(appliedChanges)) {
        reportChange(next, edgesRef.current);
      }
    },
    [readOnly, reportChange, setNodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<ReactFlowEdge<WorkflowCanvasEdgeData>>[]) => {
      const appliedChanges = readOnly
        ? filterReadOnlyEdgeChanges(changes)
        : changes;
      if (appliedChanges.length === 0) return;
      const next = applyEdgeChanges(appliedChanges, edgesRef.current);
      edgesRef.current = next;
      setEdges(next);
      if (!readOnly && hasGraphAffectingEdgeChanges(appliedChanges)) {
        reportChange(nodesRef.current, next);
      }
    },
    [readOnly, reportChange, setEdges]
  );

  const emitSelectionChange = useCallback(
    (selection: WorkflowCanvasSelection) => {
      const lastSelection = lastSelectionRef.current;
      if (
        lastSelection.nodeId === selection.nodeId &&
        lastSelection.edgeId === selection.edgeId
      ) {
        return;
      }
      lastSelectionRef.current = selection;
      onSelectionChange?.(selection);
    },
    [onSelectionChange]
  );

  const applySelection = useCallback(
    (selection: WorkflowCanvasSelection) => {
      const nextNodes = nodesRef.current.map((node) => ({
        ...node,
        selected: selection.nodeId === node.id,
      }));
      const nextEdges = edgesRef.current.map((edge) => ({
        ...edge,
        selected: selection.edgeId === edge.id,
      }));
      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      emitSelectionChange(selection);
    },
    [emitSelectionChange, setEdges, setNodes]
  );

  useEffect(() => {
    selectEdgeRef.current = (edgeId: string) => {
      applySelection({ nodeId: null, edgeId });
    };
  }, [applySelection]);

  const deleteEdgeById = useCallback(
    (edgeId: string) => {
      if (readOnly) return;
      const nextEdges = edgesRef.current.filter((edge) => edge.id !== edgeId);
      if (nextEdges.length === edgesRef.current.length) return;
      edgesRef.current = nextEdges;
      setEdges(nextEdges);
      reportChange(nodesRef.current, nextEdges);
      applySelection({ nodeId: null, edgeId: null });
    },
    [applySelection, readOnly, reportChange, setEdges]
  );

  useEffect(() => {
    if (readOnly) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!WORKFLOW_CANVAS_DELETE_KEYS.includes(event.key)) return;
      if (isEditableKeyboardTarget(event.target)) return;
      const selectedEdgeId = lastSelectionRef.current.edgeId;
      if (!selectedEdgeId) return;
      event.preventDefault();
      deleteEdgeById(selectedEdgeId);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [deleteEdgeById, readOnly]);

  const onCanvasDoubleClickCapture = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!onNodeOpen) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      const nodeElement = target.closest('.react-flow__node[data-id]');
      const nodeId = nodeElement?.getAttribute('data-id');
      if (!nodeId) return;
      const node = nodesRef.current.find(
        (candidate) => candidate.id === nodeId
      );
      if (node?.type === 'start' || node?.type === 'end') return;

      event.stopPropagation();
      applySelection({ nodeId, edgeId: null });
      onNodeOpen(nodeId);
    },
    [applySelection, onNodeOpen]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      const next = addEdge(
        {
          ...connection,
          id:
            connection.source && connection.target
              ? `${connection.source}-${connection.target}`
              : undefined,
          type: WORKFLOW_REACT_FLOW_EDGE_TYPE,
          sourceHandle: normalizeWorkflowPortHandle(
            connection.sourceHandle,
            DEFAULT_SOURCE_HANDLE
          ),
          targetHandle: normalizeWorkflowPortHandle(
            connection.targetHandle,
            DEFAULT_TARGET_HANDLE
          ),
          data: { workflowType: 'default' },
        },
        edgesRef.current
      ) as ReactFlowEdge<WorkflowCanvasEdgeData>[];
      edgesRef.current = next;
      setEdges(next);
      reportChange(nodesRef.current, next);
    },
    [readOnly, reportChange, setEdges]
  );

  const onReconnect = useCallback(
    (
      oldEdge: ReactFlowEdge<WorkflowCanvasEdgeData>,
      newConnection: Connection
    ) => {
      if (readOnly) return;
      const normalizedConnection = {
        ...newConnection,
        sourceHandle: normalizeWorkflowPortHandle(
          newConnection.sourceHandle,
          DEFAULT_SOURCE_HANDLE
        ),
        targetHandle: normalizeWorkflowPortHandle(
          newConnection.targetHandle,
          DEFAULT_TARGET_HANDLE
        ),
      };
      const next = reconnectEdge(
        oldEdge,
        normalizedConnection,
        edgesRef.current,
        {
          shouldReplaceId: false,
        }
      ) as ReactFlowEdge<WorkflowCanvasEdgeData>[];
      edgesRef.current = next;
      setEdges(next);
      reportChange(nodesRef.current, next);
    },
    [readOnly, reportChange, setEdges]
  );

  const onSelectionChangeReactFlow = useCallback(
    ({
      nodes: selectedNodes,
      edges: selectedEdges,
    }: {
      nodes: ReactFlowNode[];
      edges: ReactFlowEdge[];
    }) => {
      const hasSingleNode = selectedNodes.length === 1;
      const hasSingleEdge = selectedEdges.length === 1;
      if (!hasSingleNode && !hasSingleEdge) {
        return;
      }
      emitSelectionChange({
        nodeId: hasSingleNode && !hasSingleEdge ? selectedNodes[0].id : null,
        edgeId: hasSingleEdge && !hasSingleNode ? selectedEdges[0].id : null,
      });
    },
    [emitSelectionChange]
  );

  const onDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (readOnly) return;
      if (!event.dataTransfer.types.includes(WORKFLOW_NODE_DRAG_DATA_TYPE)) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    },
    [readOnly]
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (readOnly || !onNodeDrop) return;

      const nodeKind = event.dataTransfer.getData(WORKFLOW_NODE_DRAG_DATA_TYPE);
      if (!isWorkflowNodeKind(nodeKind)) return;

      event.preventDefault();
      onNodeDrop(
        nodeKind,
        screenToFlowPosition({ x: event.clientX, y: event.clientY })
      );
    },
    [onNodeDrop, readOnly, screenToFlowPosition]
  );

  return (
    <div
      className="relative h-full w-full bg-[#101114]"
      onDoubleClickCapture={onCanvasDoubleClickCapture}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onSelectionChange={onSelectionChangeReactFlow}
        onNodeClick={(event, node) => {
          applySelection({ nodeId: node.id, edgeId: null });
          if (
            event.target instanceof Element &&
            event.target.closest('.react-flow__handle')
          ) {
            return;
          }
        }}
        onNodeDoubleClick={(_, node) => {
          if (node.type === 'start' || node.type === 'end') return;
          applySelection({ nodeId: node.id, edgeId: null });
          onNodeOpen?.(node.id);
        }}
        onNodeContextMenu={(event, node) => {
          if (node.type === 'start' || node.type === 'end') return;
          event.preventDefault();
          applySelection({ nodeId: node.id, edgeId: null });
          onNodeContextMenu?.({
            nodeId: node.id,
            x: event.clientX,
            y: event.clientY,
          });
        }}
        onEdgeClick={(_, edge) =>
          applySelection({ nodeId: null, edgeId: edge.id })
        }
        onPaneClick={() => applySelection({ nodeId: null, edgeId: null })}
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodesDraggable
        nodesConnectable={!readOnly}
        edgesReconnectable={!readOnly}
        reconnectRadius={16}
        connectionMode={WORKFLOW_CANVAS_CONNECTION_MODE}
        elementsSelectable={true}
        connectionLineType={WORKFLOW_CANVAS_CONNECTION_LINE_TYPE}
        connectionLineStyle={{
          stroke: 'hsl(var(--brand))',
          strokeWidth: 2,
          strokeDasharray: '8 8',
        }}
        snapToGrid
        snapGrid={WORKFLOW_CANVAS_SNAP_GRID}
        deleteKeyCode={readOnly ? null : WORKFLOW_CANVAS_DELETE_KEYS}
        fitView
        className="workflow-canvas workflow-canvas-product bg-[#101114]"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={WORKFLOW_CANVAS_SNAP_GRID[0]}
          size={1.5}
          color="#2e333b"
        />
        <Controls className="rounded-lg border border-white/10 bg-[#17191f]/90 text-high shadow-lg backdrop-blur" />
        <MiniMap
          zoomable
          pannable
          nodeColor="#f97316"
          maskColor="rgba(16, 17, 20, 0.54)"
          style={{ backgroundColor: WORKFLOW_CANVAS_MINIMAP_BACKGROUND }}
          className="overflow-hidden rounded-lg border border-white/10 shadow-lg"
        />
      </ReactFlow>
    </div>
  );
}
