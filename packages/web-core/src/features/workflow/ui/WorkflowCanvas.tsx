import {
  useCallback,
  useEffect,
  useRef,
  type DragEvent,
  type PointerEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
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
  MarkerType,
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
  type DefaultEdgeOptions,
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
import { coerceWorkflowNodeExecutorConfig } from '../model/workflowAgentNodeDraft';
import {
  buildWorkflowEdgeStateMap,
  getWorkflowCanvasNodeState,
  getWorkflowCanvasNodeStateLabel,
  type WorkflowCanvasEdgeState,
  type WorkflowCanvasNodeState,
  type WorkflowNodeExecutionStatusMap,
} from '../model/workflowCanvasVisualState';
import { isWorkflowNodeAuthorable } from '../model/workflowNodeCatalog';
import {
  AlertTriangle,
  Copy,
  MessageSquare,
  Pencil,
  Play,
  Settings2,
  Trash2,
} from 'lucide-react';
import {
  WORKFLOW_CANVAS_CLASS_NAMES,
  WORKFLOW_CANVAS_EDGE_CLASSES,
  WORKFLOW_CANVAS_EDGE_STATE_PATH_CLASSES,
  WORKFLOW_CANVAS_GROUP_COLOR_CLASSES,
  WORKFLOW_CANVAS_NODE_STATE_CHIP_CLASSES,
  WORKFLOW_CANVAS_NODE_STATE_DOT_CLASSES,
  WORKFLOW_CANVAS_NODE_SURFACE_CLASSES,
  WORKFLOW_CANVAS_NOTE_COLOR_CLASSES,
  getWorkflowNodeIdentityClass,
  getWorkflowNodeStatusClass,
} from './workflowCanvasTokens';

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
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  readOnly?: boolean;
  onChange?: (graph: WorkflowGraph) => void;
  onSelectionChange?: (selection: WorkflowCanvasSelection) => void;
  onNodeDrop?: (kind: WorkflowNodeKind, position: WorkflowNodePosition) => void;
  onNodeOpen?: (nodeId: string) => void;
  onNodeEdit?: (nodeId: string) => void;
  onNodeRunStep?: (nodeId: string) => void;
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
  duplicate?: (nodeId: string) => void;
  delete?: (nodeId: string) => void | Promise<void>;
}

interface WorkflowCanvasEdgeData extends ReactFlowWorkflowEdgeData {
  onSelect?: (edgeId: string) => void;
  onActionMenu?: (event: WorkflowEdgeActionMenuEvent) => void;
  visualStatus?: WorkflowCanvasEdgeState;
  connectionIssue?: WorkflowCanvasConnectionIssue;
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

export type WorkflowCanvasConnectionIssue =
  | 'missing_endpoint'
  | 'missing_node'
  | 'self_edge'
  | 'end_source'
  | 'start_target';

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
          : WORKFLOW_CANVAS_NODE_SURFACE_CLASSES.actionButton
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
  const { t } = useTranslation('common');
  const readOnly = actions.readOnly === true;

  return (
    <div
      className={cn(
        WORKFLOW_CANVAS_NODE_SURFACE_CLASSES.toolbar,
        selected
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-1 opacity-0'
      )}
    >
      <WorkflowNodeActionButton
        label={t('workflow.canvas.openSession')}
        disabled={!actions.open}
        onClick={() => actions.open?.(nodeId)}
      >
        <MessageSquare className="h-3.5 w-3.5" />
      </WorkflowNodeActionButton>
      <WorkflowNodeActionButton
        label={t('buttons.edit')}
        disabled={readOnly || !actions.edit}
        onClick={() => actions.edit?.(nodeId)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </WorkflowNodeActionButton>
      <WorkflowNodeActionButton
        label={
          actions.runStep
            ? t('workflow.canvas.runStep')
            : t('workflow.canvas.runStepUnavailable')
        }
        disabled={readOnly || !actions.runStep}
        onClick={() => actions.runStep?.(nodeId)}
      >
        <Play className="h-3.5 w-3.5" />
      </WorkflowNodeActionButton>
      <WorkflowNodeActionButton
        label={t('workflow.editor.duplicate')}
        disabled={readOnly || !actions.duplicate}
        onClick={() => actions.duplicate?.(nodeId)}
      >
        <Copy className="h-3.5 w-3.5" />
      </WorkflowNodeActionButton>
      <WorkflowNodeActionButton
        danger
        label={t('buttons.delete')}
        disabled={readOnly || !actions.delete}
        onClick={() => void actions.delete?.(nodeId)}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </WorkflowNodeActionButton>
    </div>
  );
}

const workflowHandleClass = WORKFLOW_CANVAS_NODE_SURFACE_CLASSES.handle;

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
  const { t } = useTranslation('common');
  const nodeKind = type ?? 'agent';
  const Icon = getWorkflowNodeIcon(nodeKind);
  const visual = getWorkflowNodeVisual(nodeKind);
  const metadata = getWorkflowNodeMetadata(nodeKind, data, t);
  const routeHints = getWorkflowNodeRouteHints(nodeKind, data, t);
  const validationIssues = getValidationIssues(data);
  const issueCount = validationIssues.length;
  const structural = nodeKind === 'start' || nodeKind === 'end';
  const compactAgent = nodeKind === 'agent';
  const sessionReady = hasSession(data);
  const agentDisplay = compactAgent ? getWorkflowAgentDisplay(data) : null;
  const nodeState = getNodeUiState(data);
  const nodeStateLabel = getWorkflowCanvasNodeStateLabel(nodeState, t);
  const isRunning = nodeState === 'running';
  const isStale = isNodeStaleForNextRun(data);
  const actions = getNodeActions(data);

  const premiumClasses = cn(
    'node-premium-dark',
    getWorkflowNodeIdentityClass(nodeKind, agentDisplay?.executor),
    getWorkflowNodeStatusClass(nodeState),
    selected && 'node-selected',
    (nodeKind === 'condition' || nodeKind === 'human_gate') &&
      'node-lower-weight'
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
        data-testid={`workflow-node-${id}`}
        style={{ pointerEvents: 'all' }}
        className={cn(
          'relative flex min-w-[120px] cursor-grab items-center gap-2 overflow-visible px-3 py-2 text-normal active:cursor-grabbing',
          premiumClasses
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
            className={cn(
              'absolute -right-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border bg-amber-500 px-1 text-[10px] font-semibold text-white shadow-sm',
              WORKFLOW_CANVAS_NODE_SURFACE_CLASSES.issueBadgeBorder
            )}
          >
            {issueCount}
          </div>
        ) : null}
        <span
          data-testid={`workflow-node-status-dot-${id}`}
          title={nodeStateLabel}
          className={cn(
            'workflow-status-dot absolute right-2 top-2 h-2.5 w-2.5 rounded-full border border-[var(--workflow-node-port-ring)]',
            WORKFLOW_CANVAS_NODE_STATE_DOT_CLASSES[nodeState],
            isRunning && 'workflow-status-dot-running'
          )}
        />
        <div
          style={nodeAccentStyle}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border opacity-80"
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-high">
            {data.display_name || getWorkflowNodeKindLabel(nodeKind, t)}
          </div>
          <div
            data-testid={`workflow-node-kind-${id}`}
            className="text-[9px] font-semibold uppercase tracking-normal text-low"
          >
            {getWorkflowNodeKindLabel(nodeKind, t)}
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
        'workflow-agent-step-node relative min-w-[236px] max-w-[280px] cursor-grab overflow-visible text-high active:cursor-grabbing',
        premiumClasses,
        isStale && 'border-amber-400/70 shadow-amber-500/10'
      )}
    >
      {renderWorkflowHandles({
        canReceive: true,
        canStart: true,
      })}
      {!structural ? (
        <WorkflowNodeHoverToolbar
          actions={actions}
          nodeId={id}
          selected={selected}
        />
      ) : null}

      {issueCount > 0 ? (
        <div
          data-testid={`workflow-node-issue-${id}`}
          title={validationIssues.map((issue) => issue.message).join('\n')}
          className={cn(
            'absolute -right-2 -top-2 z-10 flex h-5 min-w-5 items-center justify-center rounded-full border bg-amber-500 px-1 text-[10px] font-semibold text-white shadow-sm',
            WORKFLOW_CANVAS_NODE_SURFACE_CLASSES.issueBadgeBorder
          )}
        >
          {issueCount}
        </div>
      ) : null}
      <span
        data-testid={`workflow-node-status-dot-${id}`}
        title={nodeStateLabel}
        className={cn(
          'workflow-status-dot absolute right-3 top-3 z-10 h-2.5 w-2.5 rounded-full border border-[var(--workflow-node-bg)]',
          WORKFLOW_CANVAS_NODE_STATE_DOT_CLASSES[nodeState],
          isRunning && 'workflow-status-dot-running'
        )}
      />
      {isStale ? (
        <span
          data-testid={`workflow-node-stale-${id}`}
          title={t('workflow.canvas.updatedForNextRunTitle')}
          className={WORKFLOW_CANVAS_NODE_SURFACE_CLASSES.staleBadge}
        >
          {t('workflow.canvas.updatedForNextRun')}
        </span>
      ) : null}

      <div className="flex items-start gap-3 border-b border-white/5 bg-white/[0.02] px-3 py-2 pl-4">
        <div
          style={nodeAccentStyle}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border"
        >
          {agentDisplay?.executor ? (
            <AgentIcon agent={agentDisplay.executor} className="h-4 w-4" />
          ) : (
            <Icon className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-high">
            {data.display_name || type || t('workflow.canvas.nodeFallback')}
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
              : getWorkflowNodeKindLabel(nodeKind, t)}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 px-3 py-2 pl-4 text-xs text-low">
        {!compactAgent ? (
          <div
            data-testid={`workflow-node-summary-${id}`}
            className="truncate text-normal"
          >
            {getWorkflowNodeSummary(nodeKind, data, t)}
          </div>
        ) : null}

        {nodeKind === 'arena' &&
        Array.isArray(data.attempts) &&
        data.attempts.length > 0 ? (
          <div className="text-[10px] text-low/80 flex flex-col gap-1">
            <div className="flex items-center gap-1.5 mt-1">
              <span>
                {t('workflow.metadata.attempts', { defaultValue: 'Attempts' })}
              </span>
              <div className="flex -space-x-1.5 overflow-hidden">
                {data.attempts.map((attempt, idx) => {
                  const execConfig = coerceWorkflowNodeExecutorConfig(
                    attempt.executor_config
                  );
                  const exec = execConfig?.executor ?? 'default_agent';
                  const identityClass = getWorkflowNodeIdentityClass(
                    'agent',
                    exec
                  );
                  return (
                    <span
                      key={attempt.id ?? idx}
                      title={attempt.display_name || exec}
                      className={cn(
                        'inline-block h-2.5 w-2.5 rounded-full ring-2 ring-[rgba(23,25,31,0.95)]',
                        identityClass
                      )}
                      style={{
                        backgroundColor: 'rgba(var(--node-color-rgb), 1)',
                      }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-1 mt-1">
          <span
            data-testid={`workflow-node-status-${id}`}
            className={cn(
              'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none',
              WORKFLOW_CANVAS_NODE_STATE_CHIP_CLASSES[nodeState]
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
              {sessionReady
                ? t('workflow.canvas.sessionReady')
                : t('workflow.canvas.draftSession')}
            </span>
          ) : (
            <span className={WORKFLOW_CANVAS_NODE_SURFACE_CLASSES.chip}>
              {getWorkflowNodeKindLabel(nodeKind, t)}
            </span>
          )}
          {agentDisplay ? (
            <span
              data-testid={`workflow-node-agent-model-${id}`}
              className={WORKFLOW_CANVAS_NODE_SURFACE_CLASSES.chipTruncate}
              title={agentDisplay.modelLabel}
            >
              {agentDisplay.modelLabel}
            </span>
          ) : null}
          {agentDisplay?.reasoningLabel ? (
            <span className={WORKFLOW_CANVAS_NODE_SURFACE_CLASSES.chipTruncate}>
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
  const { t } = useTranslation('common');
  const actions = getCanvasObjectActions(data);
  const readOnly = actions.readOnly === true;
  const color = data.color ?? 'amber';

  return (
    <div
      data-testid={`workflow-note-${id}`}
      className={cn(
        WORKFLOW_CANVAS_NODE_SURFACE_CLASSES.note,
        WORKFLOW_CANVAS_NOTE_COLOR_CLASSES[color],
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
          placeholder={t('workflow.defaultGraph.noteTitle')}
          readOnly={readOnly}
          onChange={(event) =>
            actions.update?.(id, { title: event.target.value })
          }
          onPointerDown={(event) => event.stopPropagation()}
        />
        <button
          type="button"
          className="nodrag nopan flex h-7 w-7 shrink-0 items-center justify-center rounded border border-white/10 bg-black/20 text-low transition-colors hover:border-error/50 hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t('workflow.canvas.deleteNote')}
          title={t('workflow.canvas.deleteNote')}
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
        placeholder={t('workflow.canvas.notePlaceholder')}
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
  const { t } = useTranslation('common');
  const actions = getCanvasObjectActions(data);
  const readOnly = actions.readOnly === true;
  const color = data.color ?? 'neutral';

  return (
    <div
      data-testid={`workflow-stage-group-${id}`}
      className={cn(
        WORKFLOW_CANVAS_NODE_SURFACE_CLASSES.stageGroup,
        WORKFLOW_CANVAS_GROUP_COLOR_CLASSES[color],
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
            placeholder={t('workflow.editor.stage')}
            readOnly={readOnly}
            onChange={(event) =>
              actions.update?.(id, { title: event.target.value })
            }
            onPointerDown={(event) => event.stopPropagation()}
          />
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-white/10 bg-black/15 text-low transition-colors hover:border-error/50 hover:text-error disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={t('workflow.canvas.deleteStageGroup')}
            title={t('workflow.canvas.deleteStageGroup')}
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
          placeholder={t('workflow.canvas.stageDescriptionPlaceholder')}
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
export const WORKFLOW_CANVAS_EDGE_INTERACTION_WIDTH = 32;
export const WORKFLOW_CANVAS_RECONNECT_RADIUS = 16;
export const WORKFLOW_CANVAS_DEFAULT_EDGE_OPTIONS = {
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: 'context-stroke',
    width: 20,
    height: 20,
    markerUnits: 'userSpaceOnUse',
    strokeWidth: 2.2,
  },
  interactionWidth: WORKFLOW_CANVAS_EDGE_INTERACTION_WIDTH,
} satisfies DefaultEdgeOptions;
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

export function getWorkflowCanvasConnectionIssue(
  connection: { source?: string | null; target?: string | null },
  nodeTypeById: ReadonlyMap<string, string | null | undefined>
): WorkflowCanvasConnectionIssue | null {
  const source = connection.source;
  const target = connection.target;
  if (!source || !target) return 'missing_endpoint';
  if (!nodeTypeById.has(source) || !nodeTypeById.has(target)) {
    return 'missing_node';
  }
  if (source === target) return 'self_edge';
  if (nodeTypeById.get(source) === 'end') return 'end_source';
  if (nodeTypeById.get(target) === 'start') return 'start_target';
  return null;
}

export function isWorkflowCanvasConnectionAllowed(
  connection: { source?: string | null; target?: string | null },
  nodeTypeById: ReadonlyMap<string, string | null | undefined>
): boolean {
  return getWorkflowCanvasConnectionIssue(connection, nodeTypeById) === null;
}

function getWorkflowCanvasConnectionIssueMessage(
  issue: WorkflowCanvasConnectionIssue,
  connection: { source?: string | null; target?: string | null }
): string {
  switch (issue) {
    case 'missing_endpoint':
      return 'Edge is missing a source or target node.';
    case 'missing_node':
      return 'Edge references a node that no longer exists.';
    case 'self_edge':
      return `Self-edge found on node ${connection.source ?? ''}`;
    case 'end_source':
      return 'End nodes cannot start outgoing edges.';
    case 'start_target':
      return 'Start nodes cannot receive incoming edges.';
  }
}

function getWorkflowCanvasNodeTypeById(
  nodes: Array<{ id: string; type?: string | null }>
): Map<string, string | null | undefined> {
  return new Map(nodes.map((node) => [node.id, node.type]));
}

export function getWorkflowSelfLoopPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}): [string, number, number] {
  const leftX = Math.min(sourceX, targetX);
  const rightX = Math.max(sourceX, targetX);
  const controlX = rightX + 96;
  const controlTopY = Math.min(sourceY, targetY) - 76;
  const controlBottomY = Math.max(sourceY, targetY) + 76;
  const path = `M ${sourceX},${sourceY} C ${controlX},${controlTopY} ${controlX},${controlBottomY} ${targetX},${targetY}`;
  return [path, Math.max(leftX + 58, controlX), (sourceY + targetY) / 2];
}

const WorkflowEdge = ({
  id,
  source,
  target,
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
  const { t } = useTranslation('common');
  const workflowType = data?.workflowType ?? 'default';
  const onSelect = data?.onSelect;
  const onActionMenu = data?.onActionMenu;
  const connectionIssue = data?.connectionIssue;
  const isInvalid = Boolean(connectionIssue);
  const visualStatus = isInvalid ? 'failed' : (data?.visualStatus ?? 'idle');
  const isRunning = visualStatus === 'running';
  const visual = getWorkflowEdgeVisual(workflowType, t);
  const statusPathClass = WORKFLOW_CANVAS_EDGE_STATE_PATH_CLASSES[visualStatus];
  const [edgePath, labelX, labelY] =
    source === target
      ? getWorkflowSelfLoopPath({ sourceX, sourceY, targetX, targetY })
      : getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
          borderRadius: 18,
        });
  const connectionIssueMessage = connectionIssue
    ? getWorkflowCanvasConnectionIssueMessage(connectionIssue, {
        source,
        target,
      })
    : null;
  const openActionMenu = (
    event: PointerEvent<HTMLButtonElement> | MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (onActionMenu) {
      onActionMenu({
        edgeId: id,
        x: event.clientX,
        y: event.clientY,
      });
      return;
    }
    onSelect?.(id);
  };

  return (
    <>
      <g
        data-testid={`workflow-edge-${id}`}
        className={cn(
          'group workflow-edge-group',
          selected && 'workflow-edge-group-selected',
          isRunning && 'workflow-edge-group-running',
          isInvalid && 'workflow-edge-group-invalid'
        )}
      >
        <BaseEdge
          id={`${id}-track`}
          path={edgePath}
          interactionWidth={0}
          className="workflow-edge-track"
          style={{
            strokeWidth: isRunning ? 5.5 : selected || isInvalid ? 4.5 : 3.5,
          }}
        />
        <BaseEdge
          id={id}
          path={edgePath}
          markerEnd={markerEnd}
          interactionWidth={WORKFLOW_CANVAS_EDGE_INTERACTION_WIDTH}
          className={cn(
            'workflow-edge-path',
            selected && 'workflow-edge-path-selected',
            selected ? 'stroke-brand' : statusPathClass
          )}
          style={{
            strokeWidth:
              visualStatus === 'running'
                ? 2.8
                : selected || visualStatus === 'failed' || isInvalid
                  ? 2.4
                  : 1.5,
            opacity:
              visualStatus === 'running'
                ? 1
                : visualStatus === 'idle'
                  ? 0.58
                  : 0.88,
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
          style={{ strokeWidth: isRunning ? 3.35 : selected ? 2.25 : 1.5 }}
        />
        {connectionIssueMessage ? (
          <EdgeLabelRenderer>
            <div
              className="nodrag nopan absolute"
              style={{
                transform: `translate(-50%, -50%) translate(${labelX}px, ${
                  labelY - 30
                }px)`,
                pointerEvents: 'none',
              }}
            >
              <span
                data-testid={`workflow-edge-invalid-${id}`}
                title={connectionIssueMessage}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-error/55 bg-error/15 text-error shadow-[0_0_16px_rgba(239,68,68,0.32)]"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
              </span>
            </div>
          </EdgeLabelRenderer>
        ) : null}
        {onSelect ? (
          <foreignObject
            x={labelX - 20}
            y={labelY - 20}
            width={40}
            height={40}
            className={cn(
              'workflow-edge-action overflow-visible opacity-0 group-hover:opacity-100',
              selected && 'opacity-100'
            )}
          >
            <div className="flex h-10 w-10 items-center justify-center">
              <button
                type="button"
                data-testid={`workflow-edge-action-${id}`}
                className={WORKFLOW_CANVAS_EDGE_CLASSES.actionButton}
                onPointerDown={openActionMenu}
                onPointerUp={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  if (event.detail === 0) {
                    openActionMenu(event);
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                }}
                aria-label={t('workflow.canvas.openEdgeActions', { id })}
                title={t('workflow.editor.edgeActions')}
              >
                <Settings2 className="relative z-10 h-3.5 w-3.5" />
              </button>
            </div>
          </foreignObject>
        ) : null}
      </g>
      {visual.label ? (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${
                labelY + (onSelect ? 30 : 0)
              }px)`,
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
  selectedNodeId,
  selectedEdgeId,
  readOnly = false,
  onChange,
  onSelectionChange,
  onNodeDrop,
  onNodeOpen,
  onNodeEdit,
  onNodeRunStep,
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
              selected: selectedNodeId === n.id,
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
                open: nodeType === 'agent' ? onNodeOpen : undefined,
                edit: onNodeEdit,
                runStep: nodeType === 'agent' ? onNodeRunStep : undefined,
                duplicate: onNodeDuplicate,
                delete: onNodeDelete,
              } satisfies WorkflowNodeActions,
            },
            position: n.position,
            selected: selectedNodeId === n.id,
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
        connectionIssue:
          getWorkflowCanvasConnectionIssue(
            edge,
            getWorkflowCanvasNodeTypeById(graph.nodes)
          ) ?? undefined,
        onSelect: (edgeId: string) => selectEdgeRef.current(edgeId),
        onActionMenu: onEdgeActionMenu,
      },
      selected: selectedEdgeId === edge.id,
    })) satisfies ReactFlowEdge<WorkflowCanvasEdgeData>[];
    edgesRef.current = nextEdges;
    setEdges(nextEdges);
  }, [
    graph,
    nodeStatuses,
    onEdgeActionMenu,
    onNodeDelete,
    onNodeDuplicate,
    onNodeEdit,
    onNodeOpen,
    onNodeRunStep,
    readOnly,
    selectedEdgeId,
    selectedNodeId,
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
        node.type !== 'agent'
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
      if (
        !isWorkflowCanvasConnectionAllowed(
          connection,
          getWorkflowCanvasNodeTypeById(nodesRef.current)
        )
      ) {
        return;
      }
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
      if (
        !isWorkflowCanvasConnectionAllowed(
          newConnection,
          getWorkflowCanvasNodeTypeById(nodesRef.current)
        )
      ) {
        return;
      }
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
      if (
        !isWorkflowNodeKind(nodeKind) ||
        !isWorkflowNodeAuthorable(nodeKind)
      ) {
        return;
      }

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
      className={WORKFLOW_CANVAS_CLASS_NAMES.root}
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
          if (
            node.type &&
            isWorkflowNodeKind(String(node.type)) &&
            node.type !== 'start' &&
            node.type !== 'end'
          ) {
            onNodeEdit?.(node.id);
          }
        }}
        onNodeDoubleClick={(_, node) => {
          if (
            !node.type ||
            !isWorkflowNodeKind(String(node.type)) ||
            node.type !== 'agent'
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
        isValidConnection={(connection) =>
          isWorkflowCanvasConnectionAllowed(
            connection,
            getWorkflowCanvasNodeTypeById(nodesRef.current)
          )
        }
        defaultEdgeOptions={WORKFLOW_CANVAS_DEFAULT_EDGE_OPTIONS}
        nodesDraggable
        nodesConnectable={!readOnly}
        edgesReconnectable={!readOnly}
        reconnectRadius={WORKFLOW_CANVAS_RECONNECT_RADIUS}
        elevateEdgesOnSelect
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
        className={WORKFLOW_CANVAS_CLASS_NAMES.reactFlow}
      >
        <Background
          id="bg-grid-dots"
          variant={BackgroundVariant.Dots}
          gap={WORKFLOW_CANVAS_SNAP_GRID[0]}
          size={1.5}
          color="var(--workflow-canvas-grid-dot)"
        />
        <Background
          id="bg-grid-lines"
          variant={BackgroundVariant.Lines}
          gap={WORKFLOW_CANVAS_SNAP_GRID[0] * 5}
          size={1}
          color="var(--workflow-canvas-grid-line)"
        />
        <Controls className={WORKFLOW_CANVAS_CLASS_NAMES.controls} />
      </ReactFlow>
    </div>
  );
}
