import { useCallback, useEffect, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  toReactFlowNodes,
  toReactFlowEdges,
  fromReactFlowGraph,
  isWorkflowNodeKind,
  type WorkflowGraph,
  type WorkflowNodeKind,
  type WorkflowNodeData,
  type WorkflowNodePosition,
  WORKFLOW_NODE_DRAG_DATA_TYPE,
} from '../model/workflowGraph';
import {
  getWorkflowNodeKindLabel,
  getWorkflowNodeSummary,
} from '../model/workflowPresentation';
import { getWorkflowNodeIcon } from './workflowNodeIcons';

export interface WorkflowCanvasProps {
  graph: WorkflowGraph;
  readOnly?: boolean;
  onChange?: (graph: WorkflowGraph) => void;
  onSelectionChange?: (selectedNodeId: string | null) => void;
  onNodeDrop?: (kind: WorkflowNodeKind, position: WorkflowNodePosition) => void;
}

interface BaseNodeProps {
  data: WorkflowNodeData;
  type?: WorkflowNodeKind;
  selected?: boolean;
}

const BaseNode = ({ data, type, selected }: BaseNodeProps) => {
  const nodeKind = type ?? 'agent';
  const Icon = getWorkflowNodeIcon(nodeKind);

  return (
    <div
      className={`relative min-w-[160px] rounded-lg border bg-panel shadow-sm transition-all ${
        selected
          ? 'border-brand ring-1 ring-brand'
          : 'border-secondary hover:border-brand hover:shadow-md'
      }`}
    >
      {type !== 'start' ? (
        <Handle
          type="target"
          position={Position.Top}
          className="h-3 w-3 border-2 border-panel bg-low"
        />
      ) : null}

      <div className="flex items-center gap-2 border-b border-secondary/50 bg-secondary/20 px-3 py-2">
        <Icon className="h-4 w-4 text-low" />
        <div className="truncate text-sm font-semibold text-high">
          {data.display_name || type || 'Node'}
        </div>
      </div>

      <div className="flex flex-col gap-1 px-3 py-2 text-xs text-low">
        <div className="truncate">{getWorkflowNodeSummary(nodeKind, data)}</div>
        <div className="text-[10px] uppercase tracking-normal text-low">
          {getWorkflowNodeKindLabel(nodeKind)}
        </div>
      </div>

      {type !== 'end' ? (
        <Handle
          type="source"
          position={Position.Bottom}
          className="h-3 w-3 border-2 border-panel bg-low"
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

export function WorkflowCanvas({
  graph,
  readOnly = false,
  onChange,
  onSelectionChange,
  onNodeDrop,
}: WorkflowCanvasProps) {
  const [nodes, setNodes] = useNodesState<
    ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>
  >([]);
  const [edges, setEdges] = useEdgesState<ReactFlowEdge>([]);
  const { screenToFlowPosition } = useReactFlow();

  // Sync incoming graph to internal state
  useEffect(() => {
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
        position: positionMap.get(n.id) ?? n.position,
      }));
    });
    setEdges(toReactFlowEdges(graph));
  }, [graph, setNodes, setEdges]);

  // Bubble up changes
  const reportChange = useCallback(
    (
      newNodes: ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>[],
      newEdges: ReactFlowEdge[]
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
    (changes: EdgeChange<ReactFlowEdge>[]) => {
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
            type: 'default',
          },
          currentEdges
        );
        reportChange(nodes, next);
        return next;
      });
    },
    [readOnly, nodes, reportChange, setEdges]
  );

  const onSelectionChangeReactFlow = useCallback(
    ({ nodes: selectedNodes }: { nodes: ReactFlowNode[] }) => {
      if (onSelectionChange) {
        onSelectionChange(
          selectedNodes.length === 1 ? selectedNodes[0].id : null
        );
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
      >
        <Background gap={WORKFLOW_CANVAS_SNAP_GRID[0]} />
        <Controls />
        <MiniMap zoomable pannable className="bg-panel" />
      </ReactFlow>
    </div>
  );
}
