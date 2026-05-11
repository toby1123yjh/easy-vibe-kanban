import { useCallback, useEffect, type DragEvent } from 'react';
import {
  ReactFlow,
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Position,
  getSmoothStepPath,
  useNodesState,
  useEdgesState,
  addEdge,
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
}

export interface WorkflowCanvasSelection {
  nodeId: string | null;
  edgeId: string | null;
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
      className={cn(
        'relative min-w-[220px] max-w-[260px] overflow-visible rounded-lg border bg-panel shadow-sm transition-all duration-150',
        selected
          ? 'border-brand shadow-md ring-2 ring-brand/20'
          : issueCount > 0
            ? 'border-amber-500/70 shadow-amber-500/10 hover:border-amber-500'
            : 'border-secondary hover:border-brand/70 hover:shadow-md'
      )}
    >
      {type !== 'start' ? (
        <Handle
          type="target"
          position={Position.Left}
          className="h-3 w-3 border-2 border-panel bg-low transition-colors hover:bg-brand"
        />
      ) : null}

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

      {type !== 'end' ? (
        <Handle
          type="source"
          position={Position.Right}
          className="h-3 w-3 border-2 border-panel bg-low transition-colors hover:bg-brand"
        />
      ) : null}
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
const EMPTY_VALIDATION_ISSUES: ValidationIssue[] = [];

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
}: EdgeProps<ReactFlowEdge<ReactFlowWorkflowEdgeData>>) => {
  const workflowType = data?.workflowType ?? 'default';
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
      </g>
      {visual.label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'all',
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

export function WorkflowCanvas({
  graph,
  validationIssues = EMPTY_VALIDATION_ISSUES,
  readOnly = false,
  onChange,
  onSelectionChange,
  onNodeDrop,
}: WorkflowCanvasProps) {
  const [nodes, setNodes] = useNodesState<
    ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>
  >([]);
  const [edges, setEdges] = useEdgesState<
    ReactFlowEdge<ReactFlowWorkflowEdgeData>
  >([]);
  const { screenToFlowPosition } = useReactFlow();

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
      return toReactFlowNodes(graph, fallbackPositions).map((n) => ({
        ...n,
        data: {
          ...n.data,
          __validationIssues: issuesByNodeId.get(n.id) ?? [],
        },
        position: positionMap.get(n.id) ?? n.position,
      }));
    });
    setEdges(toReactFlowEdges(graph));
  }, [graph, setNodes, setEdges, validationIssues]);

  // Bubble up changes
  const reportChange = useCallback(
    (
      newNodes: ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>[],
      newEdges: ReactFlowEdge<ReactFlowWorkflowEdgeData>[]
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
      if (readOnly) return;
      setNodes((currentNodes) => {
        const next = applyNodeChanges(changes, currentNodes) as ReactFlowNode<
          WorkflowNodeData,
          WorkflowNodeKind
        >[];
        reportChange(next, edges);
        return next;
      });
    },
    [readOnly, edges, reportChange, setNodes]
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange<ReactFlowEdge<ReactFlowWorkflowEdgeData>>[]) => {
      if (readOnly) return;
      setEdges((currentEdges) => {
        const next = applyEdgeChanges(changes, currentEdges);
        reportChange(nodes, next);
        return next;
      });
    },
    [readOnly, nodes, reportChange, setEdges]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      setEdges((currentEdges) => {
        const next = addEdge(
          {
            ...connection,
            id:
              connection.source && connection.target
                ? `${connection.source}-${connection.target}`
                : undefined,
            type: WORKFLOW_REACT_FLOW_EDGE_TYPE,
            data: { workflowType: 'default' },
          },
          currentEdges
        ) as ReactFlowEdge<ReactFlowWorkflowEdgeData>[];
        reportChange(nodes, next);
        return next;
      });
    },
    [readOnly, nodes, reportChange, setEdges]
  );

  const onSelectionChangeReactFlow = useCallback(
    ({
      nodes: selectedNodes,
      edges: selectedEdges,
    }: {
      nodes: ReactFlowNode[];
      edges: ReactFlowEdge[];
    }) => {
      if (onSelectionChange) {
        const hasSingleNode = selectedNodes.length === 1;
        const hasSingleEdge = selectedEdges.length === 1;
        onSelectionChange({
          nodeId: hasSingleNode && !hasSingleEdge ? selectedNodes[0].id : null,
          edgeId: hasSingleEdge && !hasSingleNode ? selectedEdges[0].id : null,
        });
      }
    },
    [onSelectionChange]
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
    <div className="h-full w-full bg-primary">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={onSelectionChangeReactFlow}
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={true}
        snapToGrid
        snapGrid={WORKFLOW_CANVAS_SNAP_GRID}
        deleteKeyCode={readOnly ? null : WORKFLOW_CANVAS_DELETE_KEYS}
        fitView
        className="workflow-canvas bg-primary"
      >
        <Background
          gap={WORKFLOW_CANVAS_SNAP_GRID[0]}
          color="rgba(120, 113, 108, 0.35)"
        />
        <Controls className="rounded border border-secondary bg-panel shadow-sm" />
        <MiniMap
          zoomable
          pannable
          nodeColor="#f97316"
          maskColor="rgba(0, 0, 0, 0.06)"
          className="rounded border border-secondary bg-panel shadow-sm"
        />
      </ReactFlow>
    </div>
  );
}
