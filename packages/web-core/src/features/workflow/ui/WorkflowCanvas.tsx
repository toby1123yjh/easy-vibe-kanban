import {
  useCallback,
  useEffect,
  useRef,
  useState,
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
  getSmoothStepPath,
  useNodesState,
  useEdgesState,
  addEdge,
  reconnectEdge,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
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
  WORKFLOW_GRAPH_VERSION,
  createWorkflowNode,
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
import { splitWorkflowEdgeForInsertedNode } from './workflowEdgeInsert';
import { WorkflowQuickAdd } from './WorkflowQuickAdd';

export interface WorkflowCanvasProps {
  graph: WorkflowGraph;
  validationIssues?: ValidationIssue[];
  readOnly?: boolean;
  onChange?: (graph: WorkflowGraph) => void;
  onSelectionChange?: (selection: WorkflowCanvasSelection) => void;
  onNodeDrop?: (kind: WorkflowNodeKind, position: WorkflowNodePosition) => void;
  onNodeOpen?: (nodeId: string) => void;
}

export interface WorkflowCanvasSelection {
  nodeId: string | null;
  edgeId: string | null;
}

interface WorkflowCanvasEdgeData extends ReactFlowWorkflowEdgeData {
  onInsert?: (edgeId: string, position: WorkflowNodePosition) => void;
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

const workflowHandleClass =
  'h-3.5 w-3.5 border-[3px] border-panel bg-brand/70 shadow-sm transition-colors hover:bg-brand';

const inputHandles = [
  { id: 'input-left', position: Position.Left, style: { top: '42%' } },
  { id: 'input-top', position: Position.Top, style: { left: '42%' } },
  { id: 'input-right', position: Position.Right, style: { top: '42%' } },
  { id: 'input-bottom', position: Position.Bottom, style: { left: '42%' } },
] as const;

const outputHandles = [
  { id: 'output-left', position: Position.Left, style: { top: '58%' } },
  { id: 'output-top', position: Position.Top, style: { left: '58%' } },
  { id: 'output-right', position: Position.Right, style: { top: '58%' } },
  { id: 'output-bottom', position: Position.Bottom, style: { left: '58%' } },
] as const;

const BaseNode = ({ id, data, type, selected }: BaseNodeProps) => {
  const nodeKind = type ?? 'agent';
  const Icon = getWorkflowNodeIcon(nodeKind);
  const visual = getWorkflowNodeVisual(nodeKind);
  const metadata = getWorkflowNodeMetadata(nodeKind, data);
  const routeHints = getWorkflowNodeRouteHints(nodeKind, data);
  const validationIssues = getValidationIssues(data);
  const issueCount = validationIssues.length;

  return (
    <div
      data-testid={`workflow-node-${id}`}
      style={{ pointerEvents: 'all' }}
      className={cn(
        'relative min-w-[220px] max-w-[260px] cursor-grab overflow-visible rounded-lg border bg-panel shadow-sm transition-all duration-150 active:cursor-grabbing',
        selected
          ? 'border-brand shadow-md ring-2 ring-brand/20'
          : issueCount > 0
            ? 'border-amber-500/70 shadow-amber-500/10 hover:border-amber-500'
            : 'border-secondary hover:border-brand/70 hover:shadow-md'
      )}
    >
      {type !== 'start'
        ? inputHandles.map((handle) => (
            <Handle
              key={handle.id}
              id={handle.id}
              type="target"
              position={handle.position}
              style={handle.style}
              className={workflowHandleClass}
            />
          ))
        : null}

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
          className="absolute -right-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-panel bg-amber-500 px-1 text-[10px] font-semibold text-white shadow-sm"
        >
          {issueCount}
        </div>
      ) : null}

      <div className="flex items-start gap-3 border-b border-secondary/50 bg-secondary/20 px-3 py-2 pl-4">
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded border border-secondary/60',
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
            {getWorkflowNodeKindLabel(nodeKind)}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2 pl-4 text-xs text-low">
        <div
          data-testid={`workflow-node-summary-${id}`}
          className="truncate text-normal"
        >
          {getWorkflowNodeSummary(nodeKind, data)}
        </div>

        {metadata.length > 0 ? (
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

        {routeHints.length > 0 ? (
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

      {type !== 'end'
        ? outputHandles.map((handle) => (
            <Handle
              key={handle.id}
              id={handle.id}
              type="source"
              position={handle.position}
              style={handle.style}
              className={workflowHandleClass}
            />
          ))
        : null}
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
export const WORKFLOW_CANVAS_MINIMAP_BACKGROUND =
  'hsl(var(--bg-panel, 0 0% 89%))';
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
  const onInsert = data?.onInsert;
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
          className={cn('transition-all', visual.pathClass)}
          style={{ strokeWidth: selected ? 3 : 2 }}
        />
        {onInsert ? (
          <foreignObject
            x={labelX - 12}
            y={labelY - 36}
            width={24}
            height={24}
            className="overflow-visible"
          >
            <button
              type="button"
              data-testid={`workflow-edge-insert-${id}`}
              className="nodrag nopan flex h-6 w-6 items-center justify-center rounded-full border border-secondary bg-panel text-xs font-semibold text-high shadow-sm transition-colors hover:border-brand hover:text-brand"
              onClick={(event) => {
                event.stopPropagation();
                onInsert(id, { x: labelX, y: labelY });
              }}
              aria-label={`Insert step on edge ${id}`}
            >
              +
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

export function WorkflowCanvas({
  graph,
  validationIssues = EMPTY_VALIDATION_ISSUES,
  readOnly = false,
  onChange,
  onSelectionChange,
  onNodeDrop,
  onNodeOpen,
}: WorkflowCanvasProps) {
  const [nodes, setNodes] = useNodesState<
    ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>
  >([]);
  const [edges, setEdges] = useEdgesState<
    ReactFlowEdge<WorkflowCanvasEdgeData>
  >([]);
  const [insertMenu, setInsertMenu] = useState<{
    edgeId: string;
    position: WorkflowNodePosition;
  } | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const { screenToFlowPosition } = useReactFlow();
  const lastSelectionRef = useRef<WorkflowCanvasSelection>({
    nodeId: null,
    edgeId: null,
  });
  const nodesRef = useRef<ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>[]>(
    []
  );
  const edgesRef = useRef<ReactFlowEdge<WorkflowCanvasEdgeData>[]>([]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  const startEdgeInsert = useCallback(
    (edgeId: string, position: WorkflowNodePosition) => {
      if (readOnly) return;
      setInsertMenu({ edgeId, position });
    },
    [readOnly]
  );

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
            x: 80 + (index % 4) * 220,
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
        onInsert: readOnly ? undefined : startEdgeInsert,
      },
    })) satisfies ReactFlowEdge<WorkflowCanvasEdgeData>[];
    edgesRef.current = nextEdges;
    setEdges(nextEdges);
  }, [graph, readOnly, setNodes, setEdges, startEdgeInsert, validationIssues]);

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

  const onCanvasDoubleClickCapture = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!onNodeOpen) return;
      const target = event.target;
      if (!(target instanceof Element)) return;

      const nodeElement = target.closest('.react-flow__node[data-id]');
      const nodeId = nodeElement?.getAttribute('data-id');
      if (!nodeId) return;

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
          sourceHandle: connection.sourceHandle ?? DEFAULT_SOURCE_HANDLE,
          targetHandle: connection.targetHandle ?? DEFAULT_TARGET_HANDLE,
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
      const next = reconnectEdge(oldEdge, newConnection, edgesRef.current, {
        shouldReplaceId: false,
      }) as ReactFlowEdge<WorkflowCanvasEdgeData>[];
      edgesRef.current = next;
      setEdges(next);
      reportChange(nodesRef.current, next);
    },
    [readOnly, reportChange, setEdges]
  );

  const addNodeAtViewportCenter = useCallback(
    (kind: WorkflowNodeKind) => {
      if (readOnly) return;
      const node = createWorkflowNode(kind, {
        position: screenToFlowPosition({
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        }),
      });
      const nextNode = toReactFlowNodes({
        version: WORKFLOW_GRAPH_VERSION,
        nodes: [node],
        edges: [],
      })[0];
      const nextNodes = [...nodesRef.current, nextNode];
      nodesRef.current = nextNodes;
      setNodes(nextNodes);
      reportChange(nextNodes, edgesRef.current);
    },
    [readOnly, reportChange, screenToFlowPosition, setNodes]
  );

  const insertNodeOnSelectedEdge = useCallback(
    (kind: WorkflowNodeKind) => {
      if (readOnly || !insertMenu) return;
      const edge = edgesRef.current.find(
        (candidate) => candidate.id === insertMenu.edgeId
      );
      if (!edge) {
        setInsertMenu(null);
        return;
      }

      const node = createWorkflowNode(kind, {
        position: insertMenu.position,
      });
      const nextNode = toReactFlowNodes({
        version: WORKFLOW_GRAPH_VERSION,
        nodes: [node],
        edges: [],
      })[0];
      const splitEdges = splitWorkflowEdgeForInsertedNode({
        edge,
        nodeId: node.id,
      }).map((splitEdge) => ({
        ...splitEdge,
        data: {
          workflowType: splitEdge.data?.workflowType ?? 'default',
          onInsert: startEdgeInsert,
        },
      })) satisfies ReactFlowEdge<WorkflowCanvasEdgeData>[];
      const nextNodes = [...nodesRef.current, nextNode];
      const nextEdges = edgesRef.current
        .filter((candidate) => candidate.id !== edge.id)
        .concat(splitEdges);

      nodesRef.current = nextNodes;
      edgesRef.current = nextEdges;
      setNodes(nextNodes);
      setEdges(nextEdges);
      setInsertMenu(null);
      reportChange(nextNodes, nextEdges);
    },
    [insertMenu, readOnly, reportChange, setEdges, setNodes, startEdgeInsert]
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (readOnly) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuickAddOpen(true);
      }
      if (event.key === 'Escape') {
        setQuickAddOpen(false);
        setInsertMenu(null);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [readOnly]);

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
      className="relative h-full w-full bg-primary"
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
          applySelection({ nodeId: node.id, edgeId: null });
          onNodeOpen?.(node.id);
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
        elementsSelectable={true}
        connectionLineType={WORKFLOW_CANVAS_CONNECTION_LINE_TYPE}
        snapToGrid
        snapGrid={WORKFLOW_CANVAS_SNAP_GRID}
        deleteKeyCode={readOnly ? null : WORKFLOW_CANVAS_DELETE_KEYS}
        fitView
        className="workflow-canvas bg-primary"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={WORKFLOW_CANVAS_SNAP_GRID[0]}
          size={1.5}
          color="hsl(var(--low) / 0.15)"
        />
        <Controls className="rounded-lg border border-secondary bg-panel/90 shadow-sm backdrop-blur" />
        <MiniMap
          zoomable
          pannable
          nodeColor="#f97316"
          maskColor="rgba(15, 23, 42, 0.16)"
          style={{ backgroundColor: WORKFLOW_CANVAS_MINIMAP_BACKGROUND }}
          className="overflow-hidden rounded-lg border border-secondary shadow-sm"
        />
      </ReactFlow>
      {insertMenu ? (
        <div
          role="menu"
          className="min-w-40 rounded-md border border-secondary bg-panel p-1 shadow-lg"
          style={{
            position: 'fixed',
            left: '50%',
            top: 80,
            zIndex: 9999,
            transform: 'translateX(-50%)',
          }}
        >
          <button
            type="button"
            role="menuitem"
            className="w-full rounded px-3 py-2 text-left text-sm font-medium text-high hover:bg-secondary/70"
            onClick={() => insertNodeOnSelectedEdge('agent')}
          >
            Agent Step
          </button>
        </div>
      ) : null}
      <WorkflowQuickAdd
        open={quickAddOpen && !readOnly}
        onClose={() => setQuickAddOpen(false)}
        onSelect={(kind) => {
          addNodeAtViewportCenter(kind);
          setQuickAddOpen(false);
        }}
      />
    </div>
  );
}
