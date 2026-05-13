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
  buildAgentSessionRows,
  buildWorkflowNodeDebugView,
  buildWorkspaceSessionHref,
  getNodeStatusLabel,
  getNodeStatusTone,
  selectWorkflowRunNode,
  type StatusTone,
} from '../model/workflowRunView';
import {
  DEFAULT_SOURCE_HANDLE,
  DEFAULT_TARGET_HANDLE,
  migrateWorkflowGraph,
  toReactFlowEdges,
  toReactFlowNodes,
  type WorkflowGraph,
  type WorkflowNodeData,
  type WorkflowNodeKind,
} from '../model/workflowGraph';
import { WorkflowArenaWinnerPanel } from './WorkflowArenaWinnerPanel';
import { WorkflowAgentSessionsList } from './WorkflowAgentSessionsList';
import { WORKFLOW_CANVAS_MINIMAP_BACKGROUND } from './WorkflowCanvas';
import { WorkflowNodeSessionPanel } from './WorkflowNodeSessionPanel';
import { WorkflowRunDebugPanel } from './WorkflowRunDebugPanel';

export interface WorkflowRunCanvasTabProps {
  projectId: string;
  run: WorkflowRunResponse;
}

interface RunNodeData extends WorkflowNodeData {
  execution?: WorkflowNodeExecutionResponse | null;
  isSelected?: boolean;
  nodeId?: string;
  nodeType?: WorkflowNodeKind;
  onOpenConversation?: (nodeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
}

type NodePanelTab = 'conversation' | 'details' | 'io' | 'execution';

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

const nodePanelTabs: Array<{ id: NodePanelTab; label: string }> = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'details', label: 'Details' },
  { id: 'io', label: 'Input / Output' },
  { id: 'execution', label: 'Execution' },
];

const runInputHandles = [
  { id: DEFAULT_TARGET_HANDLE, position: Position.Left },
  { id: 'input-top', position: Position.Top },
  { id: 'input-right', position: Position.Right },
  { id: 'input-bottom', position: Position.Bottom },
] as const;

const runOutputHandles = [
  { id: 'output-left', position: Position.Left },
  { id: 'output-top', position: Position.Top },
  { id: DEFAULT_SOURCE_HANDLE, position: Position.Right },
  { id: 'output-bottom', position: Position.Bottom },
] as const;

function RunNode({ data }: { data: RunNodeData }) {
  const status = data.execution?.status ?? 'pending';
  const tone = data.execution ? getNodeStatusTone(status) : 'neutral';
  const type = data.nodeType;
  const isRunning = status === 'running';
  const isWaiting = status === 'awaiting_human' || status === 'awaiting_arena';

  return (
    <div
      style={{ pointerEvents: 'all' }}
      data-testid={data.nodeId ? `workflow-run-node-${data.nodeId}` : undefined}
      onClick={(event) => {
        if (!data.nodeId) return;
        event.stopPropagation();
        data.onSelectNode?.(data.nodeId);
        if (event.detail >= 2) {
          data.onOpenConversation?.(data.nodeId);
        }
      }}
      onDoubleClick={(event) => {
        if (!data.nodeId) return;
        event.stopPropagation();
        data.onOpenConversation?.(data.nodeId);
      }}
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
      {type !== 'start'
        ? runInputHandles.map((handle) => (
            <Handle
              key={handle.id}
              id={handle.id}
              type="target"
              position={handle.position}
              className="opacity-0"
            />
          ))
        : null}
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
      {type !== 'end'
        ? runOutputHandles.map((handle) => (
            <Handle
              key={handle.id}
              id={handle.id}
              type="source"
              position={handle.position}
              className="opacity-0"
            />
          ))
        : null}
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
      return migrateWorkflowGraph(parsed);
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

function buildRunWorkspaceHref(
  projectId: string,
  run: WorkflowRunResponse
): string | null {
  return run.workspace_id
    ? `/projects/${projectId}/issues/${run.issue_id}/workspaces/${run.workspace_id}`
    : null;
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
  const [activePanelTab, setActivePanelTab] = useState<NodePanelTab>('details');
  const [nodes, setNodes, onNodesChange] = useNodesState<
    ReactFlowNode<RunNodeData, WorkflowNodeKind>
  >([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ReactFlowEdge>([]);

  const selectNodeById = useCallback((nodeId: string | null) => {
    setActionError(null);
    setSelectedNodeId(nodeId);
    setActivePanelTab('details');
  }, []);

  const openNodeConversationById = useCallback(
    (nodeId: string) => {
      setActionError(null);
      setSelectedNodeId(nodeId);

      const execution = getExecutionForNode(run, nodeId);
      setActivePanelTab(
        execution?.node_type === 'agent' ? 'conversation' : 'details'
      );
    },
    [run]
  );

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
      baseNodes.map((baseNode) => {
        const execution = execNodeMap.get(baseNode.id) ?? null;

        return {
          ...baseNode,
          data: {
            ...baseNode.data,
            execution,
            isSelected: baseNode.id === selectedNodeId,
            nodeId: baseNode.id,
            nodeType: baseNode.type,
            onOpenConversation: openNodeConversationById,
            onSelectNode: selectNodeById,
          },
        };
      })
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
  }, [
    graph,
    openNodeConversationById,
    run,
    selectNodeById,
    selectedNodeId,
    setEdges,
    setNodes,
  ]);

  const selectedExecution = selectedNodeId
    ? getExecutionForNode(run, selectedNodeId)
    : selectWorkflowRunNode(run, null);

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: ReactFlowNode[] }) => {
      setActionError(null);
      setSelectedNodeId(selectedNodes.length > 0 ? selectedNodes[0].id : null);
      setActivePanelTab('details');
    },
    []
  );

  const handleNodeClick = useCallback(
    (_event: unknown, node: ReactFlowNode<RunNodeData, WorkflowNodeKind>) => {
      selectNodeById(node.id);
    },
    [selectNodeById]
  );

  const handleNodeDoubleClick = useCallback(
    (_event: unknown, node: ReactFlowNode<RunNodeData, WorkflowNodeKind>) => {
      openNodeConversationById(node.id);
    },
    [openNodeConversationById]
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
      <div className="h-full min-h-[360px] min-w-0 flex-1 lg:min-h-0">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onSelectionChange={onSelectionChange}
          onNodeClick={handleNodeClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onPaneClick={() => selectNodeById(null)}
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
        activeTab={activePanelTab}
        graph={graph}
        isApproving={isApproving}
        isRejecting={isRejecting}
        onApprove={() => void handleApprove()}
        onReject={() => void handleReject()}
        onTabChange={setActivePanelTab}
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
  activeTab: NodePanelTab;
  graph: WorkflowGraph;
  isApproving: boolean;
  isRejecting: boolean;
  onApprove: () => void;
  onReject: () => void;
  onTabChange: (tab: NodePanelTab) => void;
  projectId: string;
  run: WorkflowRunResponse;
  selectedExecution: WorkflowNodeExecutionResponse | null;
  selectedNodeId: string | null;
}

function NodeDetailPanel({
  actionError,
  activeTab,
  graph,
  isApproving,
  isRejecting,
  onApprove,
  onReject,
  onTabChange,
  projectId,
  run,
  selectedExecution,
  selectedNodeId,
}: NodeDetailPanelProps) {
  const agentSessionRows = buildAgentSessionRows(run, selectedNodeId);
  const workspaceHref = buildRunWorkspaceHref(projectId, run);
  const sessionHref =
    selectedExecution?.node_type === 'agent'
      ? buildWorkspaceSessionHref(workspaceHref, selectedExecution.session_id)
      : null;
  const subtitle = selectedExecution
    ? `${selectedExecution.node_type} / ${selectedExecution.node_id}`
    : selectedNodeId
      ? `Node: ${selectedNodeId}`
      : 'Select a node';
  const debugView =
    selectedExecution && activeTab === 'io'
      ? buildWorkflowNodeDebugView({
          graph,
          run,
          nodeId: selectedExecution.node_id,
        })
      : null;

  return (
    <aside className="flex max-h-[50%] min-h-0 w-full flex-col overflow-hidden border-t border-secondary bg-panel lg:max-h-none lg:w-[400px] lg:border-l lg:border-t-0 xl:w-[440px]">
      <div className="border-b border-secondary p-base">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-high">
            {selectedExecution?.node_type === 'agent'
              ? 'Agent Node'
              : 'Node Details'}
          </h2>
          <p className="truncate text-xs text-low">{subtitle}</p>
        </div>

        <div
          role="tablist"
          aria-label="Workflow node panel"
          className="mt-base grid grid-cols-2 gap-1 rounded-md border border-secondary bg-primary p-1"
        >
          {nodePanelTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={cn(
                'min-w-0 rounded px-2 py-1.5 text-xs font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-panel text-high shadow-sm'
                  : 'text-low hover:text-high'
              )}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-base">
        {!selectedExecution ? (
          <div className="text-sm text-low">
            {selectedNodeId
              ? 'This node has not executed yet.'
              : 'Select a node in the canvas to view its details.'}
          </div>
        ) : activeTab === 'conversation' ? (
          <WorkflowNodeConversationPanel
            selectedExecution={selectedExecution}
            sessionHref={sessionHref}
            workspaceHref={workspaceHref}
          />
        ) : activeTab === 'details' ? (
          <NodeDetailsTab
            actionError={actionError}
            agentSessionRows={agentSessionRows}
            isApproving={isApproving}
            isRejecting={isRejecting}
            onApprove={onApprove}
            onReject={onReject}
            projectId={projectId}
            run={run}
            selectedExecution={selectedExecution}
            workspaceHref={workspaceHref}
          />
        ) : activeTab === 'io' ? (
          <WorkflowRunDebugPanel debug={debugView} />
        ) : (
          <NodeExecutionTab
            run={run}
            selectedExecution={selectedExecution}
            sessionHref={sessionHref}
            workspaceHref={workspaceHref}
          />
        )}
      </div>
    </aside>
  );
}

function NodeDetailsTab({
  actionError,
  agentSessionRows,
  isApproving,
  isRejecting,
  onApprove,
  onReject,
  projectId,
  run,
  selectedExecution,
  workspaceHref,
}: {
  actionError: string | null;
  agentSessionRows: ReturnType<typeof buildAgentSessionRows>;
  isApproving: boolean;
  isRejecting: boolean;
  onApprove: () => void;
  onReject: () => void;
  projectId: string;
  run: WorkflowRunResponse;
  selectedExecution: WorkflowNodeExecutionResponse;
  workspaceHref: string | null;
}) {
  return (
    <div className="space-y-base">
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
            {selectedExecution.output_text || 'Review this node to proceed.'}
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

      {selectedExecution.node_type === 'agent' ? (
        <WorkflowAgentSessionsList
          compact
          rows={agentSessionRows}
          workspaceHref={workspaceHref}
        />
      ) : null}
    </div>
  );
}

function WorkflowNodeConversationPanel({
  selectedExecution,
  sessionHref,
  workspaceHref,
}: {
  selectedExecution: WorkflowNodeExecutionResponse;
  sessionHref: string | null;
  workspaceHref: string | null;
}) {
  if (selectedExecution.node_type !== 'agent') {
    return (
      <div
        data-testid="workflow-node-conversation-panel"
        className="text-sm text-low"
      >
        Conversation is available for Agent nodes.
      </div>
    );
  }

  return (
    <div data-testid="workflow-node-conversation-panel" className="min-h-full">
      <WorkflowNodeSessionPanel
        execution={selectedExecution}
        sessionHref={sessionHref}
        workspaceHref={workspaceHref}
      />
    </div>
  );
}

function NodeExecutionTab({
  run,
  selectedExecution,
  sessionHref,
  workspaceHref,
}: {
  run: WorkflowRunResponse;
  selectedExecution: WorkflowNodeExecutionResponse;
  sessionHref: string | null;
  workspaceHref: string | null;
}) {
  return (
    <div className="space-y-base">
      <div className="space-y-half">
        <MetadataRow label="Run ID">{run.id}</MetadataRow>
        <MetadataRow label="Execution ID">{selectedExecution.id}</MetadataRow>
        <MetadataRow label="Node ID">{selectedExecution.node_id}</MetadataRow>
        <MetadataRow label="Node Type">
          {selectedExecution.node_type}
        </MetadataRow>
        <MetadataRow label="Session ID">
          {selectedExecution.session_id ?? 'Not started'}
        </MetadataRow>
        <MetadataRow label="Process ID">
          {selectedExecution.execution_process_id ?? 'Not started'}
        </MetadataRow>
        <MetadataRow label="Workspace ID">
          {run.workspace_id ?? 'No workspace'}
        </MetadataRow>
        <MetadataRow label="Started">
          {selectedExecution.started_at ?? 'Not started'}
        </MetadataRow>
        <MetadataRow label="Finished">
          {selectedExecution.finished_at ?? 'Not finished'}
        </MetadataRow>
      </div>

      <div className="flex flex-wrap gap-half">
        {sessionHref ? (
          <Button asChild size="xs" variant="outline">
            <a href={sessionHref}>Open session</a>
          </Button>
        ) : null}
        {workspaceHref ? (
          <Button asChild size="xs" variant="outline">
            <a href={workspaceHref}>Open workspace</a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function MetadataRow({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="rounded border border-secondary bg-primary p-half">
      <div className="text-[10px] font-semibold uppercase text-low">
        {label}
      </div>
      <div className="mt-1 break-all text-xs text-high">{children}</div>
    </div>
  );
}
