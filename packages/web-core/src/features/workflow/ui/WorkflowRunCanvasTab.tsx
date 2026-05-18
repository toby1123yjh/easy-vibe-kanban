import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge as ReactFlowEdge,
  type Node as ReactFlowNode,
} from '@xyflow/react';
import { Group, type Layout, Panel, Separator } from 'react-resizable-panels';
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
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useWorkflowRunMutations } from '@/shared/hooks/useWorkflowRun';
import { useWorkflowTemplate } from '@/shared/hooks/useWorkflowTemplates';
import { cn } from '@/shared/lib/utils';
import {
  buildWorkspaceSessionHref,
  getNodeStatusLabel,
  getNodeStatusTone,
  type StatusTone,
} from '../model/workflowRunView';
import { consumeWorkflowRunNodeFocus } from '../model/workflowRunNodeFocus';
import { queueWorkflowTemplateNodeFocus } from '../model/workflowTemplateNodeFocus';
import {
  DEFAULT_SOURCE_HANDLE,
  DEFAULT_TARGET_HANDLE,
  WORKFLOW_PORT_HANDLE_IDS,
  WORKFLOW_REACT_FLOW_EDGE_TYPE,
  migrateWorkflowGraph,
  toReactFlowEdges,
  toReactFlowNodes,
  type WorkflowGraph,
  type WorkflowNode,
  type WorkflowNodeData,
  type WorkflowNodeKind,
} from '../model/workflowGraph';
import {
  getWorkflowCanvasEdgeState,
  getWorkflowCanvasNodeState,
  getWorkflowCanvasNodeStateLabel,
  type WorkflowCanvasNodeState,
} from '../model/workflowCanvasVisualState';
import { WorkflowArenaWinnerPanel } from './WorkflowArenaWinnerPanel';
import { WorkflowNodeSessionPanel } from './WorkflowNodeSessionPanel';
import { getWorkflowAgentDisplay } from '../model/workflowAgentDisplay';
import { AgentIcon } from '@/shared/components/AgentIcon';
import { workflowCanvasEdgeTypes } from './WorkflowCanvas';

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

const statusIconMap: Record<NodeExecutionStatus, ReactNode> = {
  pending: <Clock className="h-4 w-4 text-low" />,
  running: <Activity className="h-4 w-4 text-brand" />,
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

const runNodeStateFrameClassMap: Record<WorkflowCanvasNodeState, string> = {
  draft: 'border-secondary bg-panel text-low',
  configured: 'border-secondary bg-panel text-low',
  pending: 'border-secondary bg-panel text-low',
  running:
    'border-brand/70 bg-brand/10 text-high shadow-[0_18px_48px_rgba(249,115,22,0.16)]',
  succeeded:
    'border-success/45 bg-success/10 text-high shadow-[0_18px_42px_rgba(34,197,94,0.1)]',
  failed:
    'border-error/70 bg-error/10 text-high shadow-[0_18px_42px_rgba(239,68,68,0.14)]',
  waiting:
    'border-warning/60 bg-warning/10 text-high shadow-[0_18px_42px_rgba(245,158,11,0.12)]',
  skipped: 'border-secondary bg-panel text-low opacity-80',
};

const runNodeStateChipClassMap: Record<WorkflowCanvasNodeState, string> = {
  draft: 'border-secondary bg-panel text-low',
  configured: 'border-secondary bg-panel text-low',
  pending: 'border-secondary bg-panel text-low',
  running: 'border-brand/35 bg-brand/10 text-brand',
  succeeded: 'border-success/35 bg-success/10 text-success',
  failed: 'border-error/35 bg-error/10 text-error',
  waiting: 'border-warning/35 bg-warning/10 text-warning',
  skipped: 'border-secondary bg-panel text-low',
};

const runPortHandles = [
  { id: DEFAULT_TARGET_HANDLE, position: Position.Left },
  { id: WORKFLOW_PORT_HANDLE_IDS.top, position: Position.Top },
  { id: DEFAULT_SOURCE_HANDLE, position: Position.Right },
  { id: WORKFLOW_PORT_HANDLE_IDS.bottom, position: Position.Bottom },
] as const;

function RunNode({ data }: { data: RunNodeData }) {
  const status = data.execution?.status ?? 'pending';
  const tone = data.execution ? getNodeStatusTone(status) : 'neutral';
  const type = data.nodeType;
  const nodeState = getWorkflowCanvasNodeState({
    data,
    executionStatus: data.execution?.status,
    nodeType: type ?? 'agent',
  });
  const stateLabel = getWorkflowCanvasNodeStateLabel(nodeState);
  const isRunning = status === 'running';
  const isWaiting = status === 'awaiting_human' || status === 'awaiting_arena';
  const agentDisplay = type === 'agent' ? getWorkflowAgentDisplay(data) : null;

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
        'relative min-w-[170px] cursor-pointer overflow-visible rounded-lg border px-4 py-3 shadow-sm transition-all duration-200 hover:shadow-md',
        runNodeStateFrameClassMap[nodeState] ?? toneClassMap[tone],
        isRunning && 'workflow-node-running',
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
          isRunning ? 'workflow-status-dot-running' : ''
        )}
      />
      {runPortHandles.map((handle) => (
        <Handle
          key={handle.id}
          id={handle.id}
          type={type === 'end' ? 'target' : 'source'}
          position={handle.position}
          className="opacity-0"
        />
      ))}
      <div className="flex items-center gap-3 pr-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-secondary/60 bg-primary/70 shadow-sm">
          {agentDisplay?.executor ? (
            <AgentIcon agent={agentDisplay.executor} className="h-4 w-4" />
          ) : (
            statusIconMap[status]
          )}
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">
            {data.display_name || type || 'Node'}
          </span>
          <span className="truncate text-[10px] font-semibold tracking-normal opacity-80">
            {agentDisplay
              ? `${agentDisplay.agentLabel} / ${agentDisplay.modelLabel}`
              : getNodeStatusLabel(status)}
          </span>
          <span
            className={cn(
              'mt-1 w-fit rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none',
              runNodeStateChipClassMap[nodeState]
            )}
          >
            {stateLabel}
          </span>
          {agentDisplay?.reasoningLabel ? (
            <span className="mt-1 text-[10px] font-semibold tracking-normal opacity-70">
              {agentDisplay.reasoningLabel}
            </span>
          ) : null}
        </div>
      </div>
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
        x: 80 + (index % 4) * 320,
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
  const navigation = useAppNavigation();
  const { approveNode, rejectNode, isApproving, isRejecting } =
    useWorkflowRunMutations();
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<
    ReactFlowNode<RunNodeData, WorkflowNodeKind>
  >([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ReactFlowEdge>([]);
  const consumedQueuedFocusForRunRef = useRef<string | null>(null);

  const selectNodeById = useCallback((nodeId: string | null) => {
    setActionError(null);
    setSelectedNodeId(nodeId);
  }, []);

  const openNodeConversationById = useCallback((nodeId: string) => {
    setActionError(null);
    setSelectedNodeId(nodeId);
  }, []);

  useEffect(() => {
    if (consumedQueuedFocusForRunRef.current === run.id) return;
    consumedQueuedFocusForRunRef.current = run.id;

    const queuedFocus = consumeWorkflowRunNodeFocus(run.id);
    if (!queuedFocus) return;

    setActionError(null);
    setSelectedNodeId(queuedFocus.nodeId);
  }, [run.id]);

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

        return {
          ...baseEdge,
          type: WORKFLOW_REACT_FLOW_EDGE_TYPE,
          data: {
            ...baseEdge.data,
            visualStatus: getWorkflowCanvasEdgeState(sourceExecution?.status),
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
    : null;
  const selectedGraphNode =
    graph && selectedNodeId
      ? (graph.nodes.find((node) => node.id === selectedNodeId) ?? null)
      : null;
  const isWideRunSidePanel =
    selectedExecution?.node_type === 'agent' ||
    selectedGraphNode?.type === 'agent';
  const runCanvasLayout: Layout = isWideRunSidePanel
    ? { 'workflow-run-canvas': 62, 'workflow-run-side': 38 }
    : { 'workflow-run-canvas': 74, 'workflow-run-side': 26 };

  const onSelectionChange = useCallback(
    ({ nodes: selectedNodes }: { nodes: ReactFlowNode[] }) => {
      setActionError(null);
      setSelectedNodeId(selectedNodes.length > 0 ? selectedNodes[0].id : null);
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

  const handleEditSelectedNodeConfig = useCallback(() => {
    const nodeId = selectedExecution?.node_id ?? selectedNodeId;
    if (nodeId) {
      queueWorkflowTemplateNodeFocus(run.workflow_id, {
        nodeId,
        panel: 'edit',
      });
    }
    navigation.goToProjectWorkflowEdit(projectId, run.workflow_id);
  }, [
    navigation,
    projectId,
    run.workflow_id,
    selectedExecution?.node_id,
    selectedNodeId,
  ]);

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
    <div className="h-full w-full bg-primary">
      <Group
        orientation="horizontal"
        className="h-full min-w-0 overflow-hidden"
        defaultLayout={runCanvasLayout}
      >
        <Panel
          id="workflow-run-canvas"
          minSize="35%"
          className="min-w-0 overflow-hidden"
        >
          <div className="h-full min-h-[360px] min-w-0">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={workflowCanvasEdgeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onSelectionChange={onSelectionChange}
              onNodeClick={handleNodeClick}
              onNodeDoubleClick={handleNodeDoubleClick}
              onPaneClick={() => selectNodeById(null)}
              nodesDraggable={false}
              nodesConnectable={false}
              connectionMode={ConnectionMode.Loose}
              elementsSelectable={true}
              fitView
              className="workflow-canvas workflow-canvas-product bg-[#101114]"
            >
              <Background
                variant={BackgroundVariant.Dots}
                size={1.5}
                color="#2e333b"
              />
              <Controls className="workflow-canvas-controls rounded-lg border border-white/20 bg-[#1d2028] text-high shadow-[0_12px_32px_rgba(0,0,0,0.42)] backdrop-blur" />
            </ReactFlow>
          </div>
        </Panel>

        <Separator
          id="workflow-run-separator"
          className="w-1 cursor-col-resize bg-panel outline-none transition-colors hover:bg-brand/50"
        />

        <Panel
          id="workflow-run-side"
          minSize="320px"
          maxSize="760px"
          className="min-w-0 overflow-hidden border-l border-secondary bg-panel"
        >
          <NodeDetailPanel
            actionError={actionError}
            isApproving={isApproving}
            isRejecting={isRejecting}
            onApprove={() => void handleApprove()}
            onReject={() => void handleReject()}
            projectId={projectId}
            run={run}
            selectedExecution={selectedExecution}
            selectedGraphNode={selectedGraphNode}
            selectedNodeId={selectedNodeId}
            onEditWorkflowConfig={handleEditSelectedNodeConfig}
          />
        </Panel>
      </Group>
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
  selectedGraphNode: WorkflowNode | null;
  selectedNodeId: string | null;
  onEditWorkflowConfig: () => void;
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
  selectedGraphNode,
  selectedNodeId,
  onEditWorkflowConfig,
}: NodeDetailPanelProps) {
  const workspaceHref = buildRunWorkspaceHref(projectId, run);
  const sessionHref =
    selectedExecution?.node_type === 'agent'
      ? buildWorkspaceSessionHref(workspaceHref, selectedExecution.session_id)
      : null;
  const isAgent =
    selectedExecution?.node_type === 'agent' ||
    selectedGraphNode?.type === 'agent';
  const agentDisplay =
    selectedGraphNode?.type === 'agent'
      ? getWorkflowAgentDisplay(selectedGraphNode.data)
      : null;
  const title =
    selectedGraphNode?.data.display_name ||
    (isAgent ? 'Agent Step Session' : 'Node Details');
  const subtitle = selectedExecution
    ? getNodeStatusLabel(selectedExecution.status)
    : selectedNodeId
      ? 'Not executed yet'
      : 'Select a node';

  if (isAgent && selectedExecution) {
    return (
      <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-panel">
        <div
          key={`agent-session-${selectedExecution.node_id}`}
          className="workflow-side-panel-content h-full min-h-0"
        >
          <WorkflowNodeConversationPanel
            selectedExecution={selectedExecution}
            selectedGraphNode={selectedGraphNode}
            workspaceId={run.workspace_id}
            sessionHref={sessionHref}
            workspaceHref={workspaceHref}
            onEditConfig={onEditWorkflowConfig}
          />
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-panel">
      <div className="border-b border-secondary p-base">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-high">{title}</h2>
          <div className="mt-1 flex flex-wrap gap-1">
            {agentDisplay ? (
              <>
                <span className="rounded border border-brand/25 bg-brand/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-brand">
                  {agentDisplay.agentLabel}
                </span>
                <span className="max-w-[220px] truncate rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium leading-none text-low">
                  {agentDisplay.modelLabel}
                </span>
              </>
            ) : null}
            <span className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium leading-none text-low">
              {subtitle}
            </span>
          </div>
        </div>
      </div>

      <div
        key={`node-detail-${selectedExecution?.node_id ?? selectedNodeId ?? 'empty'}`}
        className={cn(
          'workflow-side-panel-content flex-1',
          isAgent ? 'min-h-0 overflow-hidden p-0' : 'overflow-y-auto p-base'
        )}
      >
        {!selectedExecution ? (
          <div className="text-sm text-low">
            {selectedNodeId
              ? 'This node has not executed yet.'
              : 'Select a node in the canvas to view its details.'}
          </div>
        ) : isAgent ? (
          <WorkflowNodeConversationPanel
            selectedExecution={selectedExecution}
            selectedGraphNode={selectedGraphNode}
            workspaceId={run.workspace_id}
            sessionHref={sessionHref}
            workspaceHref={workspaceHref}
            onEditConfig={onEditWorkflowConfig}
          />
        ) : (
          <NodeDetailsTab
            actionError={actionError}
            isApproving={isApproving}
            isRejecting={isRejecting}
            onApprove={onApprove}
            onReject={onReject}
            projectId={projectId}
            run={run}
            selectedExecution={selectedExecution}
            workspaceHref={workspaceHref}
          />
        )}
      </div>
    </aside>
  );
}

function NodeDetailsTab({
  actionError,
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

      {selectedExecution.error_text ? (
        <div className="rounded border border-error/50 bg-error/10 p-half">
          <h3 className="text-xs font-semibold uppercase text-error">Error</h3>
          <pre className="mt-half whitespace-pre-wrap text-xs text-error">
            {selectedExecution.error_text}
          </pre>
        </div>
      ) : null}

      <NodeExecutionTab
        run={run}
        selectedExecution={selectedExecution}
        sessionHref={null}
        workspaceHref={workspaceHref}
      />
    </div>
  );
}

function WorkflowNodeConversationPanel({
  selectedExecution,
  selectedGraphNode,
  workspaceId,
  sessionHref,
  workspaceHref,
  onEditConfig,
}: {
  selectedExecution: WorkflowNodeExecutionResponse;
  selectedGraphNode: WorkflowNode | null;
  workspaceId: string | null;
  sessionHref: string | null;
  workspaceHref: string | null;
  onEditConfig: () => void;
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
    <div data-testid="workflow-node-conversation-panel" className="h-full">
      <WorkflowNodeSessionPanel
        execution={selectedExecution}
        workspaceId={workspaceId}
        sessionHref={sessionHref}
        workspaceHref={workspaceHref}
        nodeTitle={selectedGraphNode?.data.display_name}
        nodeData={selectedGraphNode?.data ?? null}
        statusLabel={getNodeStatusLabel(selectedExecution.status)}
        onEditConfig={onEditConfig}
        runStepDisabled
        runStepTitle="Single-step run is not available yet."
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
