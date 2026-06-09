import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
import { Checkbox } from '@vibe/ui/components/Checkbox';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useWorkflowRunMutations } from '@/shared/hooks/useWorkflowRun';
import { useWorkflowTemplate } from '@/shared/hooks/useWorkflowTemplates';
import { cn } from '@/shared/lib/utils';
import { buildWorkspaceSessionHref } from '../model/workflowRunView';
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
  getConditionRouterHumanPrompt,
  getConditionRouterReason,
  parseConditionRouterOutput,
} from '../model/workflowConditionRouterOutput';
import {
  getWorkflowCanvasEdgeState,
  getWorkflowCanvasNodeState,
  getWorkflowCanvasNodeStateLabel,
} from '../model/workflowCanvasVisualState';
import { getWorkflowNodeKindLabel } from '../model/workflowPresentation';
import { WorkflowArenaWinnerPanel } from './WorkflowArenaWinnerPanel';
import { WorkflowNodeSessionPanel } from './WorkflowNodeSessionPanel';
import { getWorkflowAgentDisplay } from '../model/workflowAgentDisplay';
import { AgentIcon } from '@/shared/components/AgentIcon';
import {
  WORKFLOW_CANVAS_DEFAULT_EDGE_OPTIONS,
  workflowCanvasEdgeTypes,
} from './WorkflowCanvas';
import { getWorkflowNodeIcon } from './workflowNodeIcons';
import {
  WORKFLOW_CANVAS_CLASS_NAMES,
  WORKFLOW_CANVAS_COLOR_TOKENS,
  WORKFLOW_CANVAS_NODE_STATE_DOT_CLASSES,
  WORKFLOW_RUN_NODE_STATE_CHIP_CLASSES,
  getWorkflowNodeIdentityClass,
  getWorkflowNodeStatusClass,
} from './workflowCanvasTokens';
import { workflowNodeStatusKey } from './workflowI18n';

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

const runPortHandles = [
  { id: DEFAULT_TARGET_HANDLE, position: Position.Left },
  { id: WORKFLOW_PORT_HANDLE_IDS.top, position: Position.Top },
  { id: DEFAULT_SOURCE_HANDLE, position: Position.Right },
  { id: WORKFLOW_PORT_HANDLE_IDS.bottom, position: Position.Bottom },
] as const;

function RunNode({ data }: { data: RunNodeData }) {
  const { t } = useTranslation('common');
  const status = data.execution?.status ?? 'pending';
  const type = data.nodeType ?? 'agent';
  const structural = type === 'start' || type === 'end';
  const Icon = getWorkflowNodeIcon(type);
  const nodeState = getWorkflowCanvasNodeState({
    data,
    executionStatus: data.execution?.status,
    nodeType: type,
  });
  const stateLabel = getWorkflowCanvasNodeStateLabel(nodeState, t);
  const isRunning = status === 'running';
  const agentDisplay = type === 'agent' ? getWorkflowAgentDisplay(data) : null;
  const handles = runPortHandles.map((handle) => (
    <Handle
      key={handle.id}
      id={handle.id}
      type={type === 'end' ? 'target' : 'source'}
      position={handle.position}
      className="opacity-0"
    />
  ));

  const premiumClasses = cn(
    'node-premium-dark',
    getWorkflowNodeIdentityClass(type, agentDisplay?.executor),
    getWorkflowNodeStatusClass(nodeState),
    data.isSelected && 'node-selected',
    (type === 'condition' || type === 'human_gate') && 'node-lower-weight'
  );
  const nodeAccentStyle = {
    borderColor: 'rgba(var(--node-color-rgb), 0.58)',
    background:
      'linear-gradient(135deg, rgba(var(--node-color-rgb), 0.24), rgba(var(--node-color-rgb), 0.08))',
    color: 'rgb(var(--node-color-rgb))',
    boxShadow:
      '0 0 18px rgba(var(--node-color-rgb), 0.24), inset 0 0 0 1px rgba(255, 255, 255, 0.06)',
  };

  if (structural) {
    return (
      <div
        style={{ pointerEvents: 'all' }}
        data-testid={
          data.nodeId ? `workflow-run-node-${data.nodeId}` : undefined
        }
        onClick={(event) => {
          if (!data.nodeId) return;
          event.stopPropagation();
          data.onSelectNode?.(data.nodeId);
        }}
        className={cn(
          'relative flex min-w-[120px] cursor-pointer items-center gap-2 overflow-visible px-3 py-2 text-normal',
          premiumClasses
        )}
      >
        {handles}
        <span
          className={cn(
            'workflow-status-dot absolute right-2 top-2 h-2.5 w-2.5 rounded-full border border-[var(--workflow-node-port-ring)]',
            WORKFLOW_CANVAS_NODE_STATE_DOT_CLASSES[nodeState],
            isRunning ? 'workflow-status-dot-running' : ''
          )}
          title={stateLabel}
        />
        <div
          style={nodeAccentStyle}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border opacity-80"
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-high">
            {data.display_name || getWorkflowNodeKindLabel(type, t)}
          </div>
          <div className="text-[9px] font-semibold uppercase tracking-normal text-low">
            {getWorkflowNodeKindLabel(type, t)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ pointerEvents: 'all' }}
      data-testid={data.nodeId ? `workflow-run-node-${data.nodeId}` : undefined}
      onClick={(event) => {
        if (!data.nodeId) return;
        event.stopPropagation();
        data.onSelectNode?.(data.nodeId);
        if (event.detail >= 2 && !structural) {
          data.onOpenConversation?.(data.nodeId);
        }
      }}
      onDoubleClick={(event) => {
        if (!data.nodeId) return;
        event.stopPropagation();
        if (!structural) {
          data.onOpenConversation?.(data.nodeId);
        }
      }}
      className={cn(
        'relative min-w-[210px] cursor-pointer overflow-visible text-high active:cursor-grabbing',
        premiumClasses
      )}
    >
      <span
        className={cn(
          'absolute right-3 top-3 h-2.5 w-2.5 rounded-full border border-panel shadow-sm',
          WORKFLOW_CANVAS_NODE_STATE_DOT_CLASSES[nodeState],
          isRunning ? 'workflow-status-dot-running' : ''
        )}
      />
      {handles}
      <div className="flex items-start gap-3 border-b border-white/5 bg-white/[0.02] px-3 py-2.5 pl-4">
        <div
          style={nodeAccentStyle}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
        >
          {agentDisplay?.executor ? (
            <AgentIcon agent={agentDisplay.executor} className="h-4 w-4" />
          ) : (
            (statusIconMap[status] ?? <Icon className="h-4 w-4" />)
          )}
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-high">
            {data.display_name || type || t('workflow.canvas.nodeFallback')}
          </span>
          <span className="truncate text-[10px] font-semibold tracking-normal text-low opacity-80 mt-0.5">
            {agentDisplay
              ? `${agentDisplay.agentLabel} / ${agentDisplay.modelLabel}`
              : t(`workflow.nodeStatus.${workflowNodeStatusKey(status)}`)}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2 pl-4 text-xs text-low">
        <div className="flex flex-wrap gap-1">
          <span
            className={cn(
              'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none',
              WORKFLOW_RUN_NODE_STATE_CHIP_CLASSES[nodeState]
            )}
          >
            {stateLabel}
          </span>
          {agentDisplay?.reasoningLabel ? (
            <span className="inline-flex items-center rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium leading-none text-low">
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

interface ConditionBranchOption {
  targetNodeId: string;
  targetLabel: string;
  condition: string | null;
}

function buildConditionBranchOptions(
  graph: WorkflowGraph,
  conditionNode: WorkflowNode,
  t: TFunction<'common'>
): ConditionBranchOption[] {
  if (conditionNode.type !== 'condition') return [];

  const branchByTarget = new Map(
    (conditionNode.data.branches ?? [])
      .filter((branch) => branch.target_node_id)
      .map((branch) => [branch.target_node_id as string, branch])
  );
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const seenTargets = new Set<string>();
  const options: ConditionBranchOption[] = [];

  for (const edge of graph.edges) {
    if (edge.source !== conditionNode.id || seenTargets.has(edge.target)) {
      continue;
    }
    seenTargets.add(edge.target);

    const targetNode = nodeById.get(edge.target);
    const branch = branchByTarget.get(edge.target);
    const targetLabel =
      targetNode?.data.display_name?.trim() ||
      (targetNode ? getWorkflowNodeKindLabel(targetNode.type, t) : edge.target);
    const condition = branch?.condition?.trim();

    options.push({
      targetNodeId: edge.target,
      targetLabel,
      condition: condition && condition.length > 0 ? condition : null,
    });
  }

  return options;
}

export function WorkflowRunCanvasTab({
  projectId,
  run,
}: WorkflowRunCanvasTabProps) {
  const { t } = useTranslation('common');
  const { data: template, isLoading: isTemplateLoading } = useWorkflowTemplate(
    run.workflow_id
  );
  const navigation = useAppNavigation();
  const {
    approveNode,
    rejectNode,
    selectConditionBranch,
    isApproving,
    isRejecting,
    isSelectingConditionBranch,
  } = useWorkflowRunMutations();
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
        const targetExecution = execNodeMap.get(baseEdge.target);

        return {
          ...baseEdge,
          type: WORKFLOW_REACT_FLOW_EDGE_TYPE,
          data: {
            ...baseEdge.data,
            visualStatus: getWorkflowCanvasEdgeState(
              sourceExecution?.status,
              targetExecution?.status
            ),
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
    selectedExecution?.node_type === 'condition' ||
    selectedGraphNode?.type === 'agent' ||
    selectedGraphNode?.type === 'condition';
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
        err instanceof Error
          ? err.message
          : t('workflow.dashboard.approveFailed')
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
        err instanceof Error
          ? err.message
          : t('workflow.dashboard.rejectFailed')
      );
    }
  };

  const handleSelectConditionBranch = async (targetNodeIds: string[]) => {
    if (!selectedExecution) return;
    setActionError(null);
    try {
      await selectConditionBranch({
        runId: run.id,
        nodeId: selectedExecution.node_id,
        payload: {
          selected_target_node_ids: targetNodeIds,
        },
      });
    } catch (err) {
      setActionError(
        err instanceof Error
          ? err.message
          : t('workflow.runCanvas.conditionBranchFailed')
      );
    }
  };

  if (isTemplateLoading) {
    return (
      <div className="flex h-full items-center justify-center text-low">
        <Activity className="mr-2 h-4 w-4 animate-spin" />
        {t('workflow.runCanvas.loadingGraph')}
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="flex h-full items-center justify-center p-base text-sm text-error">
        {t('workflow.runCanvas.loadGraphFailed')}
      </div>
    );
  }

  return (
    <div className="workflow-canvas-shell h-full w-full bg-primary">
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
              defaultEdgeOptions={WORKFLOW_CANVAS_DEFAULT_EDGE_OPTIONS}
              nodesDraggable={false}
              nodesConnectable={false}
              connectionMode={ConnectionMode.Loose}
              elementsSelectable={true}
              fitView
              className={WORKFLOW_CANVAS_CLASS_NAMES.reactFlow}
            >
              <Background
                variant={BackgroundVariant.Dots}
                size={1.5}
                color={WORKFLOW_CANVAS_COLOR_TOKENS.grid}
              />
              <Controls className={WORKFLOW_CANVAS_CLASS_NAMES.controls} />
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
          className={WORKFLOW_CANVAS_CLASS_NAMES.sidePanel}
        >
          <NodeDetailPanel
            actionError={actionError}
            isApproving={isApproving}
            isRejecting={isRejecting}
            isSelectingConditionBranch={isSelectingConditionBranch}
            onApprove={() => void handleApprove()}
            onReject={() => void handleReject()}
            onSelectConditionBranch={(targetNodeIds) =>
              void handleSelectConditionBranch(targetNodeIds)
            }
            graph={graph}
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
  graph: WorkflowGraph;
  isApproving: boolean;
  isRejecting: boolean;
  isSelectingConditionBranch: boolean;
  onApprove: () => void;
  onReject: () => void;
  onSelectConditionBranch: (targetNodeIds: string[]) => void;
  projectId: string;
  run: WorkflowRunResponse;
  selectedExecution: WorkflowNodeExecutionResponse | null;
  selectedGraphNode: WorkflowNode | null;
  selectedNodeId: string | null;
  onEditWorkflowConfig: () => void;
}

function NodeDetailPanel({
  actionError,
  graph,
  isApproving,
  isRejecting,
  isSelectingConditionBranch,
  onApprove,
  onReject,
  onSelectConditionBranch,
  projectId,
  run,
  selectedExecution,
  selectedGraphNode,
  selectedNodeId,
  onEditWorkflowConfig,
}: NodeDetailPanelProps) {
  const { t } = useTranslation('common');
  const workspaceHref = buildRunWorkspaceHref(projectId, run);
  const sessionHref = selectedExecution
    ? buildWorkspaceSessionHref(workspaceHref, selectedExecution.session_id)
    : null;
  const isAgent =
    selectedExecution?.node_type === 'agent' ||
    selectedGraphNode?.type === 'agent';
  const isCondition =
    selectedExecution?.node_type === 'condition' ||
    selectedGraphNode?.type === 'condition';
  const isConversationalNode = isAgent || isCondition;
  const conversationNodeData =
    selectedGraphNode?.type === 'condition'
      ? {
          ...selectedGraphNode.data,
          executor_config: graph.router_executor_config,
        }
      : (selectedGraphNode?.data ?? null);
  const agentDisplay =
    isConversationalNode && conversationNodeData
      ? getWorkflowAgentDisplay(conversationNodeData)
      : null;
  const title =
    selectedGraphNode?.data.display_name ||
    (isAgent
      ? t('workflow.nodeSession.agentStepSession')
      : isCondition
        ? t('workflow.nodeSession.conditionRouterSession')
        : t('workflow.runCanvas.nodeDetails'));
  const subtitle = selectedExecution
    ? t(
        `workflow.nodeStatus.${workflowNodeStatusKey(selectedExecution.status)}`
      )
    : selectedNodeId
      ? t('workflow.runCanvas.notExecutedYet')
      : t('workflow.runCanvas.selectNode');

  const conditionActionPanel =
    selectedExecution?.node_type === 'condition' &&
    selectedGraphNode?.type === 'condition' &&
    selectedExecution.status === 'awaiting_human' ? (
      <ConditionRouterActionPanel
        graph={graph}
        conditionNode={selectedGraphNode}
        isSelecting={isSelectingConditionBranch}
        onSelectBranch={onSelectConditionBranch}
        selectedExecution={selectedExecution}
      />
    ) : null;

  if (isConversationalNode && selectedExecution) {
    return (
      <aside className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-panel">
        <div
          key={`node-session-${selectedExecution.node_id}`}
          className="workflow-side-panel-content h-full min-h-0"
        >
          <WorkflowNodeConversationPanel
            afterHeaderContent={conditionActionPanel}
            nodeData={conversationNodeData}
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
              ? t('workflow.runCanvas.nodeNotExecuted')
              : t('workflow.runCanvas.selectNodeDetails')}
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
            graph={graph}
            isSelectingConditionBranch={isSelectingConditionBranch}
            onSelectConditionBranch={onSelectConditionBranch}
            projectId={projectId}
            run={run}
            selectedExecution={selectedExecution}
            selectedGraphNode={selectedGraphNode}
            workspaceHref={workspaceHref}
          />
        )}
      </div>
    </aside>
  );
}

function ConditionRouterActionPanel({
  graph,
  conditionNode,
  isSelecting,
  onSelectBranch,
  selectedExecution,
}: {
  graph: WorkflowGraph;
  conditionNode: WorkflowNode;
  isSelecting: boolean;
  onSelectBranch: (targetNodeIds: string[]) => void;
  selectedExecution: WorkflowNodeExecutionResponse;
}) {
  const { t } = useTranslation('common');
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  const routerOutput = parseConditionRouterOutput(
    selectedExecution.output_text
  );
  const question =
    getConditionRouterHumanPrompt(routerOutput) ??
    selectedExecution.output_text ??
    t('workflow.runCanvas.reviewNodeToProceed');
  const reason = getConditionRouterReason(routerOutput);
  const isMulti = conditionNode.data.routing_mode === 'multi';
  const branchOptions = useMemo(
    () => buildConditionBranchOptions(graph, conditionNode, t),
    [conditionNode, graph, t]
  );

  useEffect(() => {
    setSelectedTargetIds([]);
  }, [selectedExecution.id]);

  const toggleTarget = (targetNodeId: string) => {
    setSelectedTargetIds((current) =>
      current.includes(targetNodeId)
        ? current.filter((id) => id !== targetNodeId)
        : [...current, targetNodeId]
    );
  };

  return (
    <div className="shrink-0 space-y-half border-b border-warning/30 bg-warning/10 p-base">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-warning">
          {t('workflow.runCanvas.humanActionRequired')}
        </h4>
        <p className="whitespace-pre-wrap text-xs text-high">{question}</p>
        {reason ? (
          <p className="whitespace-pre-wrap text-xs text-low">{reason}</p>
        ) : null}
      </div>

      <div className="space-y-half">
        <div className="text-[10px] font-semibold uppercase tracking-normal text-low">
          {t('workflow.runCanvas.conditionRouterBranches')}
        </div>
        {branchOptions.length === 0 ? (
          <div className="rounded border border-warning/30 bg-panel/60 p-half text-xs text-low">
            {t('workflow.runCanvas.noConditionBranches')}
          </div>
        ) : (
          <div className="space-y-half">
            {branchOptions.map((option) => {
              const checked = selectedTargetIds.includes(option.targetNodeId);
              const label = option.targetLabel;
              const targetDetail = option.targetNodeId;

              return (
                <div
                  key={option.targetNodeId}
                  className={cn(
                    'flex items-start gap-half rounded border bg-panel/80 p-half text-xs',
                    checked ? 'border-brand/45' : 'border-secondary'
                  )}
                >
                  {isMulti ? (
                    <Checkbox
                      checked={checked}
                      disabled={isSelecting}
                      onCheckedChange={() => toggleTarget(option.targetNodeId)}
                      className="mt-0.5"
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-high">
                      {label}
                    </div>
                    <div className="truncate text-[10px] text-low">
                      {targetDetail}
                    </div>
                    {option.condition ? (
                      <div className="mt-1 line-clamp-2 text-low">
                        {option.condition}
                      </div>
                    ) : null}
                  </div>
                  {isMulti ? null : (
                    <Button
                      type="button"
                      size="xs"
                      disabled={isSelecting}
                      onClick={() => onSelectBranch([option.targetNodeId])}
                    >
                      {isSelecting
                        ? t('workflow.runCanvas.selectingConditionBranch')
                        : t('workflow.runCanvas.selectConditionBranch')}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isMulti ? (
        <Button
          type="button"
          size="xs"
          disabled={isSelecting || selectedTargetIds.length === 0}
          onClick={() => onSelectBranch(selectedTargetIds)}
        >
          {isSelecting
            ? t('workflow.runCanvas.selectingConditionBranch')
            : t('workflow.runCanvas.continueSelectedBranches')}
        </Button>
      ) : null}
    </div>
  );
}

function NodeDetailsTab({
  actionError,
  isApproving,
  isRejecting,
  onApprove,
  onReject,
  graph,
  isSelectingConditionBranch,
  onSelectConditionBranch,
  projectId,
  run,
  selectedExecution,
  selectedGraphNode,
  workspaceHref,
}: {
  actionError: string | null;
  isApproving: boolean;
  isRejecting: boolean;
  onApprove: () => void;
  onReject: () => void;
  graph: WorkflowGraph;
  isSelectingConditionBranch: boolean;
  onSelectConditionBranch: (targetNodeIds: string[]) => void;
  projectId: string;
  run: WorkflowRunResponse;
  selectedExecution: WorkflowNodeExecutionResponse;
  selectedGraphNode: WorkflowNode | null;
  workspaceHref: string | null;
}) {
  const { t } = useTranslation('common');
  return (
    <div className="space-y-base">
      <div>
        <h3 className="mb-half text-xs font-semibold uppercase text-low">
          {t('workflow.dashboard.status')}
        </h3>
        <div className="flex items-center gap-half">
          {statusIconMap[selectedExecution.status]}
          <span className="text-sm capitalize text-high">
            {t(
              `workflow.nodeStatus.${workflowNodeStatusKey(selectedExecution.status)}`
            )}
          </span>
        </div>
      </div>

      {selectedExecution.status === 'awaiting_human' &&
      selectedExecution.node_type === 'condition' &&
      selectedGraphNode?.type === 'condition' ? (
        <ConditionRouterActionPanel
          graph={graph}
          conditionNode={selectedGraphNode}
          isSelecting={isSelectingConditionBranch}
          onSelectBranch={onSelectConditionBranch}
          selectedExecution={selectedExecution}
        />
      ) : selectedExecution.status === 'awaiting_human' ? (
        <div className="space-y-half rounded border border-warning/50 bg-warning/10 p-half">
          <h4 className="text-sm font-semibold text-warning">
            {t('workflow.runCanvas.humanActionRequired')}
          </h4>
          <p className="text-xs text-high">
            {selectedExecution.output_text ||
              t('workflow.runCanvas.reviewNodeToProceed')}
          </p>
          <div className="flex flex-wrap gap-half">
            <Button
              type="button"
              size="xs"
              disabled={isApproving || isRejecting}
              onClick={onApprove}
            >
              {isApproving
                ? t('workflow.runCanvas.approving')
                : t('workflow.dashboard.approve')}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={isApproving || isRejecting}
              onClick={onReject}
            >
              {isRejecting
                ? t('workflow.runCanvas.rejecting')
                : t('workflow.dashboard.reject')}
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
          <h3 className="text-xs font-semibold uppercase text-error">
            {t('workflow.dashboard.error')}
          </h3>
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
  afterHeaderContent,
  nodeData,
  selectedExecution,
  selectedGraphNode,
  workspaceId,
  sessionHref,
  workspaceHref,
  onEditConfig,
}: {
  afterHeaderContent?: ReactNode;
  nodeData?: WorkflowNodeData | null;
  selectedExecution: WorkflowNodeExecutionResponse;
  selectedGraphNode: WorkflowNode | null;
  workspaceId: string | null;
  sessionHref: string | null;
  workspaceHref: string | null;
  onEditConfig: () => void;
}) {
  const { t } = useTranslation('common');
  const supportsConversation =
    selectedExecution.node_type === 'agent' ||
    selectedExecution.node_type === 'condition';
  if (!supportsConversation) {
    return (
      <div
        data-testid="workflow-node-conversation-panel"
        className="text-sm text-low"
      >
        {t('workflow.runCanvas.conversationAgentOnly')}
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
        nodeData={nodeData ?? selectedGraphNode?.data ?? null}
        statusLabel={t(
          `workflow.nodeStatus.${workflowNodeStatusKey(selectedExecution.status)}`
        )}
        onEditConfig={onEditConfig}
        runStepDisabled
        runStepTitle={t('workflow.canvas.runStepUnavailable')}
        afterHeaderContent={afterHeaderContent}
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
  const { t } = useTranslation('common');
  return (
    <div className="space-y-base">
      <div className="space-y-half">
        <MetadataRow label={t('workflow.dashboard.runId')}>
          {run.id}
        </MetadataRow>
        <MetadataRow label={t('workflow.runCanvas.executionId')}>
          {selectedExecution.id}
        </MetadataRow>
        <MetadataRow label={t('workflow.runCanvas.nodeId')}>
          {selectedExecution.node_id}
        </MetadataRow>
        <MetadataRow label={t('workflow.runCanvas.nodeType')}>
          {selectedExecution.node_type}
        </MetadataRow>
        <MetadataRow label={t('workflow.nodeSession.sessionId')}>
          {selectedExecution.session_id ?? t('workflow.dashboard.notStarted')}
        </MetadataRow>
        <MetadataRow label={t('workflow.nodeSession.processId')}>
          {selectedExecution.execution_process_id ??
            t('workflow.dashboard.notStarted')}
        </MetadataRow>
        <MetadataRow label={t('workflow.runCanvas.workspaceId')}>
          {run.workspace_id ?? t('workflow.runCanvas.noWorkspace')}
        </MetadataRow>
        <MetadataRow label={t('workflow.runCanvas.started')}>
          {selectedExecution.started_at ?? t('workflow.dashboard.notStarted')}
        </MetadataRow>
        <MetadataRow label={t('workflow.runCanvas.finished')}>
          {selectedExecution.finished_at ?? t('workflow.runCanvas.notFinished')}
        </MetadataRow>
      </div>

      <div className="flex flex-wrap gap-half">
        {sessionHref ? (
          <Button asChild size="xs" variant="outline">
            <a href={sessionHref}>{t('attempts.openSession')}</a>
          </Button>
        ) : null}
        {workspaceHref ? (
          <Button asChild size="xs" variant="outline">
            <a href={workspaceHref}>
              {t('workflow.dashboard.openWorkflowWorkspace')}
            </a>
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
