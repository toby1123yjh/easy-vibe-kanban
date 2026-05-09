import { useCallback, useEffect } from 'react';
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
  type WorkflowGraph,
  type WorkflowNodeKind,
  type WorkflowNodeData,
} from '../model/workflowGraph';

export interface WorkflowCanvasProps {
  graph: WorkflowGraph;
  readOnly?: boolean;
  onChange?: (graph: WorkflowGraph) => void;
  onSelectionChange?: (selectedNodeId: string | null) => void;
}

interface BaseNodeProps {
  data: WorkflowNodeData;
  type?: WorkflowNodeKind;
}

const BaseNode = ({ data, type }: BaseNodeProps) => (
  <div className="relative min-w-[120px] rounded border-2 border-secondary bg-panel px-4 py-2 text-sm shadow-sm">
    {type !== 'start' ? <Handle type="target" position={Position.Top} /> : null}
    <div className="font-semibold text-high">
      {data.display_name || type || 'Node'}
    </div>
    <div className="text-xs text-low">{type}</div>
    {type !== 'end' ? (
      <Handle type="source" position={Position.Bottom} />
    ) : null}
  </div>
);

const nodeTypes = {
  start: BaseNode,
  end: BaseNode,
  agent: BaseNode,
  condition: BaseNode,
  human_gate: BaseNode,
  transform: BaseNode,
  arena: BaseNode,
};

export function WorkflowCanvas({
  graph,
  readOnly = false,
  onChange,
  onSelectionChange,
}: WorkflowCanvasProps) {
  const [nodes, setNodes] = useNodesState<
    ReactFlowNode<WorkflowNodeData, WorkflowNodeKind>
  >([]);
  const [edges, setEdges] = useEdgesState<ReactFlowEdge>([]);

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
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        elementsSelectable={true}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap zoomable pannable className="bg-panel" />
      </ReactFlow>
    </div>
  );
}
