import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge as ReactFlowEdge,
  type Node as ReactFlowNode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  Clock,
  Swords,
  User,
} from 'lucide-react';
import type {
  NodeExecutionStatus,
  WorkflowNodeExecutionResponse,
  WorkflowRunResponse,
} from 'shared/types';
import { Button } from '@vibe/ui/components/Button';
import { useWorkflowRunMutations } from '@/shared/hooks/useWorkflowRun';
import { useWorkflowTemplate } from '@/shared/hooks/useWorkflowTemplates';
import { cn } from '@/shared/lib/utils';
import {
  getNodeStatusLabel,
  getNodeStatusTone,
  selectWorkflowRunNode,
  type StatusTone,
} from '../model/workflowRunView';
import {
  toReactFlowEdges,
  toReactFlowNodes,
  type WorkflowGraph,
  type WorkflowNodeData,
  type WorkflowNodeKind,
} from '../model/workflowGraph';
import { WorkflowArenaWinnerPanel } from './WorkflowArenaWinnerPanel';
import { WORKFLOW_CANVAS_MINIMAP_BACKGROUND } from './WorkflowCanvas';

export interface WorkflowRunCanvasTabProps {
  projectId: string;
  run: WorkflowRunResponse;
}

interface RunNodeData extends WorkflowNodeData {
  execution?: WorkflowNodeExecutionResponse | null;
  isSelected?: boolean;
  nodeType?: WorkflowNodeKind;
}

const statusIconMap: Record<NodeExecutionStatus, ReactNode> = {
  pending: <Clock className="h-4 w-4 text-low" />,
  running: <Activity className="h-4 w-4 animate-pulse text-brand" />,
  succeeded: <CheckCircle className="h-4 w-4 text-success" />,
  failed: <AlertCircle className="h-4 w-4 text-error" />,
  awaiting_human: <User className="h-4 w-4 text-warning" />,
  awaiting_arena: <Swords className="h-4 w-4 text-warning" />,
  skipped: <Clock className="h-4 w-4 text-low" />,
};

const toneClassMap: Record<StatusTone, string> = {
  neutral: 'border-secondary bg-panel text-low',
  active: 'border-brand bg-brand/10 text-high',
  success: 'border-success bg-success/10 text-high',
  danger: 'border-error bg-error/10 text-high',
  warning: 'border-warning bg-warning/10 text-high',
};

const statusDotClassMap: Record<StatusTone, string> = {
  neutral: 'bg-low',
  active: 'bg-brand',
  success: 'bg-success',
  danger: 'bg-error',
  warning: 'bg-warning',
};

const edgeStrokeByTone: Record<StatusTone, string> = {
  neutral: 'hsl(var(--border))',
  active: 'hsl(var(--brand))',
  success: 'hsl(var(--success))',
  danger: 'hsl(var(--destructive))',
  warning: 'hsl(var(--warning))',
};

function RunNode({ data }: { data: RunNodeData }) {
  const status = data.execution?.status ?? 'pending';
  const tone = data.execution ? getNodeStatusTone(status) : 'neutral';
  const type = data.nodeType;
  const isRunning = status === 'running';
  const isWaiting = status === 'awaiting_human' || status === 'awaiting_arena';

  return (
    <div
      style={{ pointerEvents: 'all' }}
      className={cn(
        'relative min-w-[170px] cursor-pointer overflow-hidden rounded-lg border px-4 py-3 shadow-sm transition-all duration-200 hover:shadow-md',
        toneClassMap[tone],
        data.isSelected
          ? 'shadow-md ring-2 ring-brand/30 ring-offset-2 ring-offset-primary'
          : ''
      )}
    >
      {isRunning ? (
        <div className="absolute inset-x-0 top-0 h-0.5 bg-brand" />
      ) : null}
      {isWaiting ? (
        <div className="absolute inset-y-0 left-0 w-1 bg-warning" />
      ) : null}
      <span
        className={cn(
          'absolute right-3 top-3 h-2.5 w-2.5 rounded-full border border-panel shadow-sm',
          statusDotClassMap[tone],
          isRunning ? 'animate-pulse' : ''
        )}
      />
      {type !== 'start' ? (
        <Handle type="target" position={Position.Top} className="opacity-0" />
      ) : null}
      <div className="flex items-center gap-3 pr-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-secondary/60 bg-primary/70 shadow-sm">
          {statusIconMap[status]}
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">
            {data.display_name || type || 'Node'}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">
            {getNodeStatusLabel(status)}
          </span>
        </div>
      </div>
      {type !== 'end' ? (
        <Handle
          type="source"
          position={Position.Bottom}
          className="opacity-0"
        />
      ) : null}
    </div>
  );
}

const nodeTypes = {
  start: RunNode,
  end: RunNode,
  agent: RunNode,
  condition: RunNode,
  human_gate: RunNode,
  transform: RunNode,
  arena: RunNode,
};

function parseWorkflowGraph(graphJson: string): WorkflowGraph | null {
  try {
    const parsed = JSON.parse(graphJson) as WorkflowGraph;
    if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function getExecutionForNode(
  run: WorkflowRunResponse,
  nodeId: string
): WorkflowNodeExecutionResponse | null {
  return run.nodes.find((node) => node.node_id === nodeId) ?? null;
}

function getDefaultPositions(graph: WorkflowGraph) {
  return Object.fromEntries(
    graph.nodes.map((node, index) => [
      node.id,
      {
        x: 80 + (index % 4) * 250,
        y: 80 + Math.floor(index / 4) * 150,
      },
    ])
  );
}

export function WorkflowRunCanvasTab({
  projectId,
  run,
}: WorkflowRunCanvasTabProps) {
  const { data: template, isLoading: isTemplateLoading } = useWorkflowTemplate(
    run.workflow_id
  );
  const { approveNode, rejectNode, isApproving, isRejecting } =
    useWorkflowRunMutations();
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<
    ReactFlowNode<RunNodeData, WorkflowNodeKind>
  >([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ReactFlowEdge>([]);

  useEffect(() => {
    if (
      selectedNodeId &&
      run.nodes.some((node) => node.node_id === selectedNodeId)
    ) {
      return;
    }

    const activeNode = run.nodes.find(
      (node) =>
        node.status === 'awaiting_arena' ||
        node.status === 'awaiting_human' ||
        node.status === 'failed' ||
        node.status === 'running'
    );

    if (activeNode) {
      setSelectedNodeId(activeNode.node_id);
    }
  }, [run.nodes, selectedNodeId]);

  const graph = useMemo(
    () => (template ? parseWorkflowGraph(template.graph_json) : null),
    [template]
  );

  useEffect(() => {
    if (!graph) return;

    const execNodeMap = new Map(run.nodes.map((node) => [node.node_id, node]));
    const positions = getDefaultPositions(graph);
    const baseNodes = toReactFlowNodes(graph, positions);
    const baseEdges = toReactFlowEdges(graph);

    setNodes(
      baseNodes.map((baseNode) => ({
        ...baseNode,
        data: {
          ...baseNode.data,
          execution: execNodeMap.get(baseNode.id) ?? null,
          isSelected: baseNode.id === selectedNodeId,
          nodeType: baseNode.type,
        },
      }))
    );

    setEdges(
      baseEdges.map((baseEdge) => {
        const sourceExecution = execNodeMap.get(baseEdge.source);
        const tone = sourceExecution
          ? getNodeStatusTone(sourceExecution.status)
          : 'neutral';
        const active =
          sourceExecution?.status === 'running' ||
          sourceExecution?.status === 'succeeded';

        return {
          ...baseEdge,
          animated: sourceExecution?.status === 'running',
          style: {
            stroke: active ? edgeStrokeByTone[tone] : edgeStrokeByTone.neutral,
            strokeWidth: active ? 3 : 2,
            transition: 'stroke 0.3s ease, stroke-width 0.3s ease',
          },
        };
      })
    );
  }, [graph, run.nodes, selectedNodeId, setEdges, setNodes]);

  const selectedExecution = selectedNodeId
    ? getExecutionForNode(run, selectedNodeId)
    : selectWorkflowRunNode(run, null);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: ReactFlowNode[] }) => {
      setActionError(null);
      setSelectedNodeId(selectedNodes.length > 0 ? selectedNodes[0].id : null);
    },
    []
  );

  const handleNodeClick = useCallback(
    (_event: unknown, node: ReactFlowNode<RunNodeData, WorkflowNodeKind>) => {
      setActionError(null);
      setSelectedNodeId(node.id);
    },
    []
  );

  const handleApprove = async () => {
    if (!selectedExecution) return;
    setActionError(null);
    try {
      await approveNode({
        runId: run.id,
        nodeId: selectedExecution.node_id,
        payload: {},
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to approve node.'
      );
    }
  };

  const handleReject = async () => {
    if (!selectedExecution) return;
    setActionError(null);
    try {
      await rejectNode({
        runId: run.id,
        nodeId: selectedExecution.node_id,
        payload: {},
      });
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to reject node.'
      );
    }
  };

  if (isTemplateLoading) {
    return (
      <div className="flex h-full items-center justify-center text-low">
        <Activity className="mr-2 h-4 w-4 animate-spin" />
        Loading graph...
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="flex h-full items-center justify-center p-base text-sm text-error">
        Workflow graph could not be loaded for this run.
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-primary lg:flex-row">
      <div className="min-h-[360px] min-w-0 flex-1 lg:min-h-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={onSelectionChange}
          onNodeClick={handleNodeClick}
          onPaneClick={() => setSelectedNodeId(null)}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          fitView
        >
          <Background
            variant={BackgroundVariant.Dots}
            size={1.5}
            color="hsl(var(--low) / 0.15)"
          />
          <Controls className="rounded-lg border border-secondary bg-panel/90 shadow-sm backdrop-blur" />
          <MiniMap
            maskColor="rgba(15, 23, 42, 0.16)"
            style={{ backgroundColor: WORKFLOW_CANVAS_MINIMAP_BACKGROUND }}
            className="overflow-hidden rounded-lg border border-secondary shadow-sm"
          />
        </ReactFlow>
      </div>

      <NodeDetailPanel
        actionError={actionError}
        isApproving={isApproving}
        isRejecting={isRejecting}
        onApprove={() => void handleApprove()}
        onReject={() => void handleReject()}
        projectId={projectId}
        run={run}
        selectedExecution={selectedExecution}
        selectedNodeId={selectedNodeId}
      />
    </div>
  );
}

interface NodeDetailPanelProps {
  actionError: string | null;
  isApproving: boolean;
  isRejecting: boolean;
  onApprove: () => void;
  onReject: () => void;
  projectId: string;
  run: WorkflowRunResponse;
  selectedExecution: WorkflowNodeExecutionResponse | null;
  selectedNodeId: string | null;
}

function NodeDetailPanel({
  actionError,
  isApproving,
  isRejecting,
  onApprove,
  onReject,
  projectId,
  run,
  selectedExecution,
  selectedNodeId,
}: NodeDetailPanelProps) {
  return (
    <aside className="flex max-h-[45%] min-h-0 w-full flex-col overflow-hidden border-t border-secondary bg-panel lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
      <div className="border-b border-secondary p-base">
        <h2 className="text-sm font-semibold text-high">Node Details</h2>
        <p className="truncate text-xs text-low">
          {selectedNodeId ? `Node: ${selectedNodeId}` : 'First execution'}
        </p>
      </div>

      <div className="flex-1 space-y-base overflow-y-auto p-base">
        {!selectedExecution ? (
          <div className="text-sm text-low">
            {selectedNodeId
              ? 'This node has not executed yet.'
              : 'Select a node in the canvas to view its details.'}
          </div>
        ) : (
          <>
            <div>
              <h3 className="mb-half text-xs font-semibold uppercase text-low">
                Status
              </h3>
              <div className="flex items-center gap-half">
                {statusIconMap[selectedExecution.status]}
                <span className="text-sm capitalize text-high">
                  {getNodeStatusLabel(selectedExecution.status)}
                </span>
              </div>
            </div>

            {selectedExecution.status === 'awaiting_human' ? (
              <div className="space-y-half rounded border border-warning/50 bg-warning/10 p-half">
                <h4 className="text-sm font-semibold text-warning">
                  Human action required
                </h4>
                <p className="text-xs text-high">
                  {selectedExecution.output_text ||
                    'Review this node to proceed.'}
                </p>
                <div className="flex flex-wrap gap-half">
                  <Button
                    type="button"
                    size="xs"
                    disabled={isApproving || isRejecting}
                    onClick={onApprove}
                  >
                    {isApproving ? 'Approving...' : 'Approve'}
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    disabled={isApproving || isRejecting}
                    onClick={onReject}
                  >
                    {isRejecting ? 'Rejecting...' : 'Reject'}
                  </Button>
                </div>
              </div>
            ) : null}

            {selectedExecution.status === 'awaiting_arena' ? (
              <WorkflowArenaWinnerPanel
                arenaGroupId={selectedExecution.arena_group_id}
                issueId={run.issue_id}
                nodeId={selectedExecution.node_id}
                projectId={projectId}
                runId={run.id}
              />
            ) : null}

            {actionError ? (
              <p className="text-xs text-error" role="alert">
                {actionError}
              </p>
            ) : null}

            <DetailBlock title="Input" value={selectedExecution.input_text} />
            <DetailBlock title="Output" value={selectedExecution.output_text} />

            {selectedExecution.error_text ? (
              <DetailBlock
                tone="danger"
                title="Error"
                value={selectedExecution.error_text}
              />
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}

function DetailBlock({
  title,
  value,
  tone = 'normal',
}: {
  title: string;
  value: string | null;
  tone?: 'normal' | 'danger';
}) {
  return (
    <div>
      <h3
        className={cn(
          'mb-half text-xs font-semibold uppercase',
          tone === 'danger' ? 'text-error' : 'text-low'
        )}
      >
        {title}
      </h3>
      <pre
        className={cn(
          'max-h-64 overflow-auto whitespace-pre-wrap rounded border p-half text-xs',
          tone === 'danger'
            ? 'border-error/50 bg-error/10 text-error'
            : 'border-secondary bg-primary text-high'
        )}
      >
        {value || `(No ${title.toLowerCase()} yet)`}
      </pre>
    </div>
  );
}
