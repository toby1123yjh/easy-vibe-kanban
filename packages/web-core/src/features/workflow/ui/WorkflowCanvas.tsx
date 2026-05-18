import {
  useCallback,
  useEffect,
  useRef,
  type DragEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  ReactFlow,
  BaseEdge,
  Background,
  BackgroundVariant,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  ConnectionLineType,
  ConnectionMode,
  NodeResizer,
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
  toReactFlowEdges,
  isWorkflowNodeKind,
  WORKFLOW_REACT_FLOW_EDGE_TYPE,
  type WorkflowGraph,
  type WorkflowNodeKind,
  type WorkflowNodeData,
  type WorkflowNodePosition,
  type WorkflowCanvasObjectNodeData,
  type WorkflowCanvasObjectSize,
  type WorkflowCanvasReactFlowNodeData,
  type WorkflowCanvasReactFlowNodeKind,
  type ReactFlowWorkflowEdgeData,
  WORKFLOW_NODE_DRAG_DATA_TYPE,
  toReactFlowCanvasNodes,
  fromReactFlowCanvasGraph,
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
import { AgentIcon } from '@/shared/components/AgentIcon';
import { getWorkflowAgentDisplay } from '../model/workflowAgentDisplay';
import {
  buildWorkflowEdgeStateMap,
  getWorkflowCanvasNodeState,
  getWorkflowCanvasNodeStateLabel,
  type WorkflowCanvasEdgeState,
  type WorkflowCanvasNodeState,
  type WorkflowNodeExecutionStatusMap,
} from '../model/workflowCanvasVisualState';
import {
  Copy,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';

export const WORKFLOW_CANVAS_NODE_ACTIONS = [
  'open-session',
  'edit',
  'run-step',
  'duplicate',
  'delete',
] as const;

export const WORKFLOW_CANVAS_EDGE_ACTIONS = [
  'insert-agent-step',
  'reconnect-source',
  'reconnect-target',
  'delete-edge',
] as const;

export interface WorkflowCanvasProps {
  graph: WorkflowGraph;
  validationIssues?: ValidationIssue[];
  nodeStatuses?: WorkflowNodeExecutionStatusMap;
  staleNodeIds?: readonly string[];
  readOnly?: boolean;
  onChange?: (graph: WorkflowGraph) => void;
  onSelectionChange?: (selection: WorkflowCanvasSelection) => void;
  onNodeDrop?: (kind: WorkflowNodeKind, position: WorkflowNodePosition) => void;
  onNodeOpen?: (nodeId: string) => void;
  onNodeEdit?: (nodeId: string) => void;
  onNodeRunStep?: (nodeId: string) => void;
  onNodeAddNext?: (nodeId: string) => void;
  onNodeDuplicate?: (nodeId: string) => void;
  onNodeDelete?: (nodeId: string) => void | Promise<void>;
  onNodeContextMenu?: (event: WorkflowNodeContextMenuEvent) => void;
  onEdgeActionMenu?: (event: WorkflowEdgeActionMenuEvent) => void;
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

export interface WorkflowEdgeActionMenuEvent {
  edgeId: string;
  x: number;
  y: number;
}

interface WorkflowNodeActions {
  readOnly?: boolean;
  open?: (nodeId: string) => void;
  edit?: (nodeId: string) => void;
  runStep?: (nodeId: string) => void;
  addNext?: (nodeId: string) => void;
  duplicate?: (nodeId: string) => void;
  delete?: (nodeId: string) => void | Promise<void>;
}

interface WorkflowCanvasEdgeData extends ReactFlowWorkflowEdgeData {
  onSelect?: (edgeId: string) => void;
  onActionMenu?: (event: WorkflowEdgeActionMenuEvent) => void;
  visualStatus?: WorkflowCanvasEdgeState;
}

interface WorkflowCanvasObjectActions {
  readOnly?: boolean;
  update?: (
    objectId: string,
    updates: Partial<WorkflowCanvasObjectNodeData>
  ) => void;
  resize?: (objectId: string, size: WorkflowCanvasObjectSize) => void;
  delete?: (objectId: string) => void;
}

interface BaseNodeProps {
  id: string;
  data: WorkflowNodeData;
  type?: WorkflowNodeKind;
  selected?: boolean;
}

interface CanvasObjectNodeProps {
  id: string;
  data: WorkflowCanvasObjectNodeData;
  selected?: boolean;
}

type WorkflowCanvasFlowNode = ReactFlowNode<
  WorkflowCanvasReactFlowNodeData,
  WorkflowCanvasReactFlowNodeKind
>;

const ROUTE_HINT_CLASSES: Record<string, string> = {
  brand: 'border-brand/30 bg-brand/10 text-brand',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-700',
  danger: 'border-error/30 bg-error/10 text-error',
};

const NODE_STATE_FRAME_CLASSES: Record<WorkflowCanvasNodeState, string> = {
  draft: 'border-white/12',
  configured: 'border-white/12',
  pending: 'border-white/15',
  running: 'border-brand/70 shadow-[0_20px_54px_rgba(249,115,22,0.16)]',
  succeeded: 'border-success/45 shadow-[0_16px_44px_rgba(34,197,94,0.08)]',
  failed: 'border-error/70 shadow-[0_16px_44px_rgba(239,68,68,0.14)]',
  waiting: 'border-warning/60 shadow-[0_16px_44px_rgba(245,158,11,0.12)]',
  skipped: 'border-white/10 opacity-80',
};

const NODE_STATE_CHIP_CLASSES: Record<WorkflowCanvasNodeState, string> = {
  draft: 'border-white/10 bg-white/[0.04] text-low',
  configured: 'border-white/10 bg-white/[0.04] text-low',
  pending: 'border-white/10 bg-white/[0.04] text-low',
  running: 'border-brand/35 bg-brand/10 text-brand',
  succeeded: 'border-success/35 bg-success/10 text-success',
  failed: 'border-error/35 bg-error/10 text-error',
  waiting: 'border-warning/35 bg-warning/10 text-warning',
  skipped: 'border-white/10 bg-white/[0.03] text-low',
};

const NODE_STATE_DOT_CLASSES: Record<WorkflowCanvasNodeState, string> = {
  draft: 'bg-low/60',
  configured: 'bg-low',
  pending: 'bg-low',
  running: 'bg-brand shadow-[0_0_16px_rgba(249,115,22,0.62)]',
  succeeded: 'bg-success shadow-[0_0_14px_rgba(34,197,94,0.34)]',
  failed: 'bg-error shadow-[0_0_16px_rgba(239,68,68,0.46)]',
  waiting: 'bg-warning shadow-[0_0_16px_rgba(245,158,11,0.4)]',
  skipped: 'bg-low/45',
};

const EDGE_STATE_PATH_CLASSES: Record<WorkflowCanvasEdgeState, string> = {
  idle: 'stroke-low/45',
  running: 'stroke-brand',
  succeeded: 'stroke-success/80',
  failed: 'stroke-error/85',
  waiting: 'stroke-warning/85',
  skipped: 'stroke-low/35',
};

const NOTE_COLOR_CLASSES = {
  amber: 'border-amber-300/35 bg-amber-300/12 text-amber-50',
  blue: 'border-sky-300/30 bg-sky-300/10 text-sky-50',
  green: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-50',
  neutral: 'border-white/12 bg-white/[0.06] text-high',
} satisfies Record<string, string>;

const GROUP_COLOR_CLASSES = {
  amber: 'border-amber-300/18 bg-amber-300/[0.035]',
  blue: 'border-sky-300/18 bg-sky-300/[0.035]',
  green: 'border-emerald-300/18 bg-emerald-300/[0.035]',
  neutral: 'border-white/10 bg-white/[0.025]',
} satisfies Record<string, string>;

const getValidationIssues = (data: WorkflowNodeData): ValidationIssue[] => {
  const issues = data.__validationIssues;
  return Array.isArray(issues) ? (issues as ValidationIssue[]) : [];
};

const hasSession = (data: WorkflowNodeData): boolean =>
  typeof data.session_id === 'string' && data.session_id.length > 0;

const getNodeUiState = (data: WorkflowNodeData): WorkflowCanvasNodeState =>
  (data.__workflowNodeState as WorkflowCanvasNodeState | undefined) ??
  'configured';

const isNodeStaleForNextRun = (data: WorkflowNodeData): boolean =>
  data.__workflowIsStale === true;

const getNodeActions = (data: WorkflowNodeData): WorkflowNodeActions =>
  (data.__workflowActions as WorkflowNodeActions | undefined) ?? {};

const getCanvasObjectActions = (
  data: WorkflowCanvasObjectNodeData
): WorkflowCanvasObjectActions =>
  (data.__workflowCanvasObjectActions as WorkflowCanvasObjectActions) ?? {};

function stopCanvasObjectAction(event: MouseEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
}

function WorkflowNodeActionButton({
  children,
  danger,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        'nodrag nopan flex h-7 w-7 items-center justify-center rounded border text-low shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        danger
          ? 'border-error/30 bg-error/10 hover:border-error/70 hover:text-error'
          : 'border-white/10 bg-[#20232b]/95 hover:border-brand/60 hover:bg-brand/15 hover:text-brand'
      )}
      aria-label={label}
      title={label}
      disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={stopCanvasObjectAction}
      onClick={(event) => {
        stopCanvasObjectAction(event);
        if (!disabled) onClick?.();
      }}
    >
      {children}
    </button>
  );
}

function WorkflowNodeHoverToolbar({
  actions,
  nodeId,
  selected,
}: {
  actions: WorkflowNodeActions;
  nodeId: string;
  selected?: boolean;
}) {
  const readOnly = actions.readOnly === true;

  return (
    <div
      className={cn(
        'workflow-node-toolbar nodrag nopan absolute -top-9 right-2 z-20 flex items-center gap-1 rounded-lg border border-white/10 bg-[#15171d]/96 p-1 shadow-[0_14px_34px_rgba(0,0,0,0.35)] backdrop-blur transition-all duration-150',
        selected
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-1 opacity-0'
      )}
    >
      <WorkflowNodeActionButton
        label="Open Session"
        disabled={!actions.open}
        onClick={() => actions.open?.(nodeId)}
      >
        <MessageSquare className="h-3.5 w-3.5" />
      </WorkflowNodeActionButton>
      <WorkflowNodeActionButton
        label="Edit"
        disabled={readOnly || !actions.edit}
        onClick={() => actions.edit?.(nodeId)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </WorkflowNodeActionButton>
      <WorkflowNodeActionButton
        label={actions.runStep ? 'Run Step' : 'Run Step (not available yet)'}
        disabled={readOnly || !actions.runStep}
        onClick={() => actions.runStep?.(nodeId)}
      >
        <Play className="h-3.5 w-3.5" />
      </WorkflowNodeActionButton>
      <WorkflowNodeActionButton
        label="Duplicate"
        disabled={readOnly || !actions.duplicate}
        onClick={() => actions.duplicate?.(nodeId)}
      >
        <Copy className="h-3.5 w-3.5" />
      </WorkflowNodeActionButton>
      <WorkflowNodeActionButton
        danger
        label="Delete"
        disabled={readOnly || !actions.delete}
        onClick={() => void actions.delete?.(nodeId)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </WorkflowNodeActionButton>
    </div>
  );
}

function WorkflowAddNextButton({
  actions,
  nodeId,
  selected,
}: {
  actions: WorkflowNodeActions;
  nodeId: string;
  selected?: boolean;
}) {
  const disabled = actions.readOnly === true || !actions.addNext;

  return (
    <button
      type="button"
      data-testid={`workflow-node-add-next-${nodeId}`}
      className={cn(
        'workflow-node-add-next nodrag nopan absolute -right-12 top-1/2 z-20 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-brand/40 bg-[#15171d]/96 text-brand shadow-[0_0_20px_rgba(249,115,22,0.22)] backdrop-blur transition-all duration-150 hover:border-brand hover:bg-brand hover:text-white disabled:cursor-not-allowed disabled:opacity-40',
        selected
          ? 'translate-x-0 opacity-100'
          : 'pointer-events-none translate-x-1 opacity-0'
      )}
      aria-label="Add next Agent Step"
      title="Add next Agent Step"
      disabled={disabled}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={stopCanvasObjectAction}
      onClick={(event) => {
        stopCanvasObjectAction(event);
        if (!disabled) actions.addNext?.(nodeId);
      }}
    >
      <Plus className="h-4 w-4" />
    </button>
  );
}

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
  const agentDisplay = compactAgent ? getWorkflowAgentDisplay(data) : null;
  const nodeState = getNodeUiState(data);
  const nodeStateLabel = getWorkflowCanvasNodeStateLabel(nodeState);
  const isRunning = nodeState === 'running';
  const isStale = isNodeStaleForNextRun(data);
  const actions = getNodeActions(data);
  const canAddNext = Boolean(actions.addNext) && nodeKind !== 'end';

  if (structural) {
    return (
      <div
        data-testid={`workflow-node-${id}`}
        style={{ pointerEvents: 'all' }}
        className={cn(
          'relative flex min-w-[112px] cursor-grab items-center gap-2 overflow-visible rounded-full border bg-[#15171d]/60 px-2.5 py-1.5 text-normal shadow-[0_8px_20px_rgba(0,0,0,0.18)] backdrop-blur transition-all duration-150 active:cursor-grabbing',
          selected
            ? 'border-brand/80 ring-2 ring-brand/20'
            : issueCount > 0
              ? 'border-amber-500/70'
              : 'border-white/10 hover:border-brand/40',
          NODE_STATE_FRAME_CLASSES[nodeState],
          isRunning && 'workflow-node-running'
        )}
      >
        {renderWorkflowHandles({
          canReceive: nodeKind !== 'start',
          canStart: nodeKind !== 'end',
        })}
        {canAddNext ? (
          <WorkflowAddNextButton
            actions={actions}
            nodeId={id}
            selected={selected}
          />
        ) : null}
        {issueCount > 0 ? (
          <div
            data-testid={`workflow-node-issue-${id}`}
            title={validationIssues.map((issue) => issue.message).join('\n')}
            className="absolute -right-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-[#15171d] bg-amber-500 px-1 text-[10px] font-semibold text-white shadow-sm"
          >
            {issueCount}
          </div>
        ) : null}
        <span
          data-testid={`workflow-node-status-dot-${id}`}
          title={nodeStateLabel}
          className={cn(
            'workflow-status-dot absolute right-2 top-2 h-2.5 w-2.5 rounded-full border border-[#15171d]',
            NODE_STATE_DOT_CLASSES[nodeState],
            isRunning && 'workflow-status-dot-running'
          )}
        />
        <div
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 opacity-80',
            visual.iconClass
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold">
            {data.display_name || getWorkflowNodeKindLabel(nodeKind)}
          </div>
          <div
            data-testid={`workflow-node-kind-${id}`}
            className="text-[9px] font-semibold uppercase tracking-normal text-low"
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
            : 'border-white/12 hover:border-brand/60 hover:shadow-[0_20px_54px_rgba(0,0,0,0.38)]',
        NODE_STATE_FRAME_CLASSES[nodeState],
        isRunning && 'workflow-node-running',
        isStale && 'border-amber-400/70 shadow-amber-500/10'
      )}
    >
      {renderWorkflowHandles({
        canReceive: type !== 'start',
        canStart: type !== 'end',
      })}
      {compactAgent ? (
        <WorkflowNodeHoverToolbar
          actions={actions}
          nodeId={id}
          selected={selected}
        />
      ) : null}
      {canAddNext ? (
        <WorkflowAddNextButton
          actions={actions}
          nodeId={id}
          selected={selected}
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
          className="absolute -right-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border border-[#17191f] bg-amber-500 px-1 text-[10px] font-semibold text-white shadow-sm"
        >
          {issueCount}
        </div>
      ) : null}
      <span
        data-testid={`workflow-node-status-dot-${id}`}
        title={nodeStateLabel}
        className={cn(
          'workflow-status-dot absolute right-3 top-3 z-10 h-2.5 w-2.5 rounded-full border border-[#17191f]',
          NODE_STATE_DOT_CLASSES[nodeState],
          isRunning && 'workflow-status-dot-running'
        )}
      />
      {isStale ? (
        <span
          data-testid={`workflow-node-stale-${id}`}
          title="Configuration was updated after the latest run and applies to the next run."
          className="absolute -top-2 right-2 z-10 max-w-[170px] truncate rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-semibold text-amber-200 shadow-[0_8px_22px_rgba(245,158,11,0.18)]"
        >
          Updated for next run
        </span>
      ) : null}

      <div className="flex items-start gap-3 border-b border-white/10 bg-white/[0.03] px-3 py-2 pl-4">
        <div
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-white/10',
            visual.iconClass
          )}
        >
          {agentDisplay?.executor ? (
            <AgentIcon agent={agentDisplay.executor} className="h-4 w-4" />
          ) : (
            <Icon className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-high">
            {data.display_name || type || 'Node'}
          </div>
          <div
            data-testid={`workflow-node-kind-${id}`}
            className={cn(
              'mt-0.5 truncate text-[10px] font-semibold tracking-normal text-low',
              !agentDisplay && 'uppercase'
            )}
          >
            {agentDisplay
              ? agentDisplay.detailLabel
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
            data-testid={`workflow-node-status-${id}`}
            className={cn(
              'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none',
              NODE_STATE_CHIP_CLASSES[nodeState]
            )}
          >
            {nodeStateLabel}
          </span>
          {compactAgent ? (
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
          ) : (
            <span className="inline-flex items-center rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium leading-none text-low">
              {getWorkflowNodeKindLabel(nodeKind)}
            </span>
          )}
          {agentDisplay ? (
            <span
              data-testid={`workflow-node-agent-model-${id}`}
              className="inline-flex max-w-full items-center truncate rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium leading-none text-low"
              title={agentDisplay.modelLabel}
            >
              {agentDisplay.modelLabel}
            </span>
          ) : null}
          {agentDisplay?.reasoningLabel ? (
            <span className="inline-flex max-w-full items-center truncate rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-medium leading-none text-low">
              {agentDisplay.reasoningLabel}
            </span>
          ) : null}
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

function WorkflowStickyNoteNode({ id, data, selected }: CanvasObjectNodeProps) {
  const actions = getCanvasObjectActions(data);
  const readOnly = actions.readOnly === true;
  const color = data.color ?? 'amber';

  return (
    <div
      data-testid={`workflow-note-${id}`}
      className={cn(
        'relative h-full min-h-[120px] w-full min-w-[220px] overflow-hidden rounded-lg border p-3 shadow-[0_16px_40px_rgba(0,0,0,0.22)] backdrop-blur transition-colors',
        NOTE_COLOR_CLASSES[color],
        selected ? 'ring-2 ring-brand/35' : 'hover:border-white/25'
      )}
    >
      <NodeResizer
        isVisible={selected && !readOnly}
        minWidth={220}
        minHeight={120}
        color="hsl(var(--brand))"
        onResizeEnd={(_, params) =>
          actions.resize?.(id, {
            width: params.width,
            height: params.height,
          })
        }
      />
      <div className="mb-2 flex items-center gap-2">
        <input
          className="nodrag nopan min-w-0 flex-1 bg-transparent text-xs font-semibold text-high outline-none placeholder:text-low"
          value={data.title ?? ''}
          placeholder="Note"
          readOnly={readOnly}
          onChange={(event) =>
            actions.update?.(id, { title: event.target.value })
          }
          onPointerDown={(event) => event.stopPropagation()}
        />
        <button
          type="button"
          className="nodrag nopan flex h-7 w-7 shrink-0 items-center justify-center rounded border border-white/10 bg-black/20 text-low transition-colors hover:border-error/50 hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Delete note"
          title="Delete note"
          disabled={readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            stopCanvasObjectAction(event);
            actions.delete?.(id);
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <textarea
        className="nodrag nopan h-[calc(100%-2.25rem)] w-full resize-none bg-transparent text-xs leading-5 text-normal outline-none placeholder:text-low"
        value={data.content ?? ''}
        placeholder="Write a note..."
        readOnly={readOnly}
        onChange={(event) =>
          actions.update?.(id, { content: event.target.value })
        }
        onPointerDown={(event) => event.stopPropagation()}
      />
    </div>
  );
}

function WorkflowStageGroupNode({ id, data, selected }: CanvasObjectNodeProps) {
  const actions = getCanvasObjectActions(data);
  const readOnly = actions.readOnly === true;
  const color = data.color ?? 'neutral';

  return (
    <div
      data-testid={`workflow-stage-group-${id}`}
      className={cn(
        'relative h-full min-h-[170px] w-full min-w-[360px] rounded-xl border p-4 text-low transition-colors',
        GROUP_COLOR_CLASSES[color],
        selected ? 'ring-2 ring-brand/25' : 'hover:border-white/18'
      )}
    >
      <NodeResizer
        isVisible={selected && !readOnly}
        minWidth={360}
        minHeight={170}
        color="hsl(var(--brand))"
        onResizeEnd={(_, params) =>
          actions.resize?.(id, {
            width: params.width,
            height: params.height,
          })
        }
      />
      <div className="nodrag nopan flex max-w-[360px] flex-col gap-1">
        <div className="flex items-center gap-2">
          <input
            className="min-w-0 flex-1 bg-transparent text-xs font-semibold uppercase tracking-normal text-low outline-none placeholder:text-low"
            value={data.title ?? ''}
            placeholder="Stage"
            readOnly={readOnly}
            onChange={(event) =>
              actions.update?.(id, { title: event.target.value })
            }
            onPointerDown={(event) => event.stopPropagation()}
          />
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-white/10 bg-black/15 text-low transition-colors hover:border-error/50 hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Delete stage group"
            title="Delete stage group"
            disabled={readOnly}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              stopCanvasObjectAction(event);
              actions.delete?.(id);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <textarea
          className="h-10 resize-none bg-transparent text-[11px] leading-4 text-low outline-none placeholder:text-low/70"
          value={data.description ?? ''}
          placeholder="Stage description"
          readOnly={readOnly}
          onChange={(event) =>
            actions.update?.(id, { description: event.target.value })
          }
          onPointerDown={(event) => event.stopPropagation()}
        />
      </div>
    </div>
  );
}

const nodeTypes = {
  start: BaseNode,
  end: BaseNode,
  agent: BaseNode,
  condition: BaseNode,
  human_gate: BaseNode,
  transform: BaseNode,
  arena: BaseNode,
  sticky_note: WorkflowStickyNoteNode,
  stage_group: WorkflowStageGroupNode,
};

export const WORKFLOW_CANVAS_SNAP_GRID: [number, number] = [15, 15];
export const WORKFLOW_CANVAS_DELETE_KEYS = ['Backspace', 'Delete'];
export const WORKFLOW_CANVAS_EDGE_TYPE = WORKFLOW_REACT_FLOW_EDGE_TYPE;
export const WORKFLOW_CANVAS_CONNECTION_LINE_TYPE =
  ConnectionLineType.SmoothStep;
export const WORKFLOW_CANVAS_CONNECTION_MODE = ConnectionMode.Loose;
export const WORKFLOW_CANVAS_READ_ONLY_NODE_CHANGE_TYPES = [
  'select',
  'dimensions',
  'position',
] as const;
export const WORKFLOW_CANVAS_READ_ONLY_EDGE_CHANGE_TYPES = ['select'] as const;
const EMPTY_VALIDATION_ISSUES: ValidationIssue[] = [];
const EMPTY_STALE_NODE_IDS: readonly string[] = [];

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
  const onActionMenu = data?.onActionMenu;
  const visualStatus = data?.visualStatus ?? 'idle';
  const isRunning = visualStatus === 'running';
  const visual = getWorkflowEdgeVisual(workflowType);
  const statusPathClass = EDGE_STATE_PATH_CLASSES[visualStatus];
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
          className={cn(
            'workflow-edge-path transition-all',
            selected ? 'stroke-brand' : statusPathClass
          )}
          style={{
            strokeWidth:
              selected ||
              visualStatus === 'running' ||
              visualStatus === 'failed'
                ? 3
                : 2,
            opacity: visualStatus === 'idle' ? 0.58 : 0.86,
          }}
        />
        <BaseEdge
          id={`${id}-beam`}
          path={edgePath}
          interactionWidth={0}
          className={cn(
            'workflow-edge-beam transition-opacity',
            isRunning && 'workflow-edge-beam-running',
            selected && isRunning && 'opacity-100'
          )}
          style={{ strokeWidth: selected || isRunning ? 3 : 2 }}
        />
        {onSelect ? (
          <foreignObject
            x={labelX - 14}
            y={labelY - 14}
            width={28}
            height={28}
            className={cn(
              'workflow-edge-action overflow-visible opacity-0 transition-opacity group-hover:opacity-100',
              selected && 'opacity-100'
            )}
          >
            <button
              type="button"
              data-testid={`workflow-edge-action-${id}`}
              className="nodrag nopan flex h-7 w-7 items-center justify-center rounded-full border border-brand/50 bg-[#17191f] text-brand shadow-[0_0_18px_rgba(249,115,22,0.32)] transition-colors hover:border-brand hover:bg-brand hover:text-white"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(id);
                onActionMenu?.({
                  edgeId: id,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              aria-label={`Open edge actions for ${id}`}
              title="Edge actions"
            >
              <MoreHorizontal className="h-4 w-4" />
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

export const workflowCanvasEdgeTypes = {
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
  nodeStatuses,
  staleNodeIds = EMPTY_STALE_NODE_IDS,
  readOnly = false,
  onChange,
  onSelectionChange,
  onNodeDrop,
  onNodeOpen,
  onNodeEdit,
  onNodeRunStep,
  onNodeAddNext,
  onNodeDuplicate,
  onNodeDelete,
  onNodeContextMenu,
  onEdgeActionMenu,
}: WorkflowCanvasProps) {
  const [nodes, setNodes] = useNodesState<WorkflowCanvasFlowNode>([]);
  const [edges, setEdges] = useEdgesState<
    ReactFlowEdge<WorkflowCanvasEdgeData>
  >([]);
  const { screenToFlowPosition } = useReactFlow();
  const lastSelectionRef = useRef<WorkflowCanvasSelection>({
    nodeId: null,
    edgeId: null,
  });
  const nodesRef = useRef<WorkflowCanvasFlowNode[]>([]);
  const edgesRef = useRef<ReactFlowEdge<WorkflowCanvasEdgeData>[]>([]);
  const selectEdgeRef = useRef<(edgeId: string) => void>(() => {});

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  const reportChange = useCallback(
    (
      newNodes: WorkflowCanvasFlowNode[],
      newEdges: ReactFlowEdge<WorkflowCanvasEdgeData>[]
    ) => {
      if (readOnly || !onChange) return;
      onChange(fromReactFlowCanvasGraph(newNodes, newEdges, graph));
    },
    [graph, readOnly, onChange]
  );

  const updateCanvasObjectNode = useCallback(
    (
      objectId: string,
      updates: Partial<WorkflowCanvasObjectNodeData>,
      size?: WorkflowCanvasObjectSize
    ) => {
      if (readOnly) return;
      const next = nodesRef.current.map((node) => {
        if (node.id !== objectId) return node;
        return {
          ...node,
          data: {
            ...node.data,
            ...updates,
            ...(size ? { size } : {}),
          },
          ...(size
            ? {
                style: {
                  ...(node.style ?? {}),
                  width: size.width,
                  height: size.height,
                },
              }
            : {}),
        } satisfies WorkflowCanvasFlowNode;
      });
      nodesRef.current = next;
      setNodes(next);
      reportChange(next, edgesRef.current);
    },
    [readOnly, reportChange, setNodes]
  );

  const deleteCanvasObjectNode = useCallback(
    (objectId: string) => {
      if (readOnly) return;
      const next = nodesRef.current.filter((node) => node.id !== objectId);
      if (next.length === nodesRef.current.length) return;
      nodesRef.current = next;
      setNodes(next);
      reportChange(next, edgesRef.current);
    },
    [readOnly, reportChange, setNodes]
  );

  // Sync incoming graph to internal state
  useEffect(() => {
    const issuesByNodeId = new Map<string, ValidationIssue[]>();
    const edgeStateById = buildWorkflowEdgeStateMap(graph, nodeStatuses);
    const staleNodeIdSet = new Set(staleNodeIds);
    for (const issue of validationIssues) {
      if (!issue.nodeId) continue;
      const nodeIssues = issuesByNodeId.get(issue.nodeId) ?? [];
      nodeIssues.push(issue);
      issuesByNodeId.set(issue.nodeId, nodeIssues);
    }

    setNodes(() => {
      const fallbackPositions = Object.fromEntries(
        graph.nodes.map((node, index) => [
          node.id,
          {
            x: 120 + (index % 4) * 360,
            y: 160 + Math.floor(index / 4) * 190,
          },
        ])
      );
      const nextNodes = toReactFlowCanvasNodes(graph, fallbackPositions).map(
        (n) => {
          if (!isWorkflowNodeKind(String(n.type))) {
            return {
              ...n,
              data: {
                ...n.data,
                __workflowCanvasObjectActions: {
                  readOnly,
                  update: updateCanvasObjectNode,
                  resize: (objectId: string, size: WorkflowCanvasObjectSize) =>
                    updateCanvasObjectNode(objectId, {}, size),
                  delete: deleteCanvasObjectNode,
                } satisfies WorkflowCanvasObjectActions,
              },
              position: n.position,
            } satisfies WorkflowCanvasFlowNode;
          }

          const data = n.data as WorkflowNodeData;
          const nodeType = n.type as WorkflowNodeKind;
          return {
            ...n,
            data: {
              ...data,
              __validationIssues: issuesByNodeId.get(n.id) ?? [],
              __workflowNodeState: getWorkflowCanvasNodeState({
                data,
                executionStatus: nodeStatuses?.[n.id],
                nodeType,
              }),
              __workflowIsStale: staleNodeIdSet.has(n.id),
              __workflowActions: {
                readOnly,
                open: onNodeOpen,
                edit: onNodeEdit,
                runStep: onNodeRunStep,
                addNext: onNodeAddNext,
                duplicate: onNodeDuplicate,
                delete: onNodeDelete,
              } satisfies WorkflowNodeActions,
            },
            position: n.position,
          } satisfies WorkflowCanvasFlowNode;
        }
      );
      nodesRef.current = nextNodes;
      return nextNodes;
    });
    const nextEdges = toReactFlowEdges(graph).map((edge) => ({
      ...edge,
      data: {
        workflowType: edge.data?.workflowType ?? 'default',
        visualStatus: edgeStateById[edge.id] ?? 'idle',
        onSelect: (edgeId: string) => selectEdgeRef.current(edgeId),
        onActionMenu: onEdgeActionMenu,
      },
    })) satisfies ReactFlowEdge<WorkflowCanvasEdgeData>[];
    edgesRef.current = nextEdges;
    setEdges(nextEdges);
  }, [
    graph,
    nodeStatuses,
    onEdgeActionMenu,
    onNodeAddNext,
    onNodeDelete,
    onNodeDuplicate,
    onNodeEdit,
    onNodeOpen,
    onNodeRunStep,
    readOnly,
    setNodes,
    setEdges,
    staleNodeIds,
    updateCanvasObjectNode,
    deleteCanvasObjectNode,
    validationIssues,
  ]);

  const onNodesChange = useCallback(
    (changes: NodeChange<WorkflowCanvasFlowNode>[]) => {
      const appliedChanges = readOnly
        ? filterReadOnlyNodeChanges(changes)
        : changes;
      if (appliedChanges.length === 0) return;
      const next = applyNodeChanges(
        appliedChanges,
        nodesRef.current
      ) as WorkflowCanvasFlowNode[];
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
      if (
        !node?.type ||
        !isWorkflowNodeKind(String(node.type)) ||
        node.type === 'start' ||
        node.type === 'end'
      ) {
        return;
      }

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
        edgeTypes={workflowCanvasEdgeTypes}
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
          if (
            !node.type ||
            !isWorkflowNodeKind(String(node.type)) ||
            node.type === 'start' ||
            node.type === 'end'
          ) {
            return;
          }
          applySelection({ nodeId: node.id, edgeId: null });
          onNodeOpen?.(node.id);
        }}
        onNodeContextMenu={(event, node) => {
          if (
            !node.type ||
            !isWorkflowNodeKind(String(node.type)) ||
            node.type === 'start' ||
            node.type === 'end'
          ) {
            return;
          }
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
        <Controls className="workflow-canvas-controls rounded-lg border border-white/20 bg-[#1d2028] text-high shadow-[0_12px_32px_rgba(0,0,0,0.42)] backdrop-blur" />
      </ReactFlow>
    </div>
  );
}
