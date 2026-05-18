import { useState, useEffect, useMemo, useRef } from 'react';
import {
  useWorkflowTemplate,
  useWorkflowTemplateMutations,
} from '@/shared/hooks/useWorkflowTemplates';
import {
  useWorkflowAttemptForWorkflow,
  useWorkflowAttemptMutations,
} from '@/shared/hooks/useWorkflowAttempts';
import { useWorkflowRun } from '@/shared/hooks/useWorkflowRun';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import {
  clearConditionBranchTargetForEdge,
  createWorkflowCanvasStageGroup,
  createWorkflowCanvasStickyNote,
  createDefaultWorkflowGraph,
  createWorkflowEdge,
  createWorkflowNode,
  DEFAULT_SOURCE_HANDLE,
  DEFAULT_TARGET_HANDLE,
  getConditionBranchNameForEdge,
  getConditionBranchNamesForEdge,
  migrateWorkflowGraph,
  setConditionBranchTargetForEdge,
  tidyWorkflowGraph,
  type WorkflowGraph,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowNodePosition,
} from '../model/workflowGraph';
import {
  createWorkflowAgentNodeDraftPatch,
  isWorkflowAgentDraftNode,
} from '../model/workflowAgentNodeDraft';
import {
  buildWorkflowRunInput,
  getWorkflowRunErrorMessage,
} from '../model/issueWorkflow';
import { buildWorkflowNodeExecutionStatusMap } from '../model/workflowCanvasVisualState';
import { consumeWorkflowTemplateNodeFocus } from '../model/workflowTemplateNodeFocus';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { WorkflowCanvas } from './WorkflowCanvas';
import {
  WorkflowAgentStepEditPanel,
  type WorkflowAgentStepEditValue,
} from './WorkflowAgentStepEditPanel';
import { WorkflowNodeSessionPanel } from './WorkflowNodeSessionPanel';
import { WorkflowEdgeInspector } from './WorkflowEdgeInspector';
import { WorkflowNodeInspector } from './WorkflowNodeInspector';
import {
  applyWorkflowNodeDataPatch,
  getWorkflowTemplateInspectorPanel,
} from './workflowTemplateEditorPanel';
import {
  WorkflowValidationPanel,
  validateWorkflowGraph,
} from './WorkflowValidationPanel';
import { Button } from '@vibe/ui/components/Button';
import {
  Loader2,
  ArrowLeft,
  Save,
  Copy,
  Plus,
  CheckCircle2,
  LayoutGrid,
  Play as PlayIcon,
  StickyNote,
  Ungroup,
} from 'lucide-react';
import { ReactFlowProvider } from '@xyflow/react';
import { Group, type Layout, Panel, Separator } from 'react-resizable-panels';
import type { WorkflowNodeExecutionResponse } from 'shared/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@vibe/ui/components/Dropdown';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';

const NEW_NODE_OFFSET_X = 340;
const NEW_NODE_OFFSET_Y = 0;
const NODE_COLLISION_X = 320;
const NODE_COLLISION_Y = 160;
const DUPLICATE_NODE_OFFSET_X = 80;
const DUPLICATE_NODE_OFFSET_Y = 80;

interface AgentStepContextMenuState {
  nodeId: string;
  x: number;
  y: number;
}

interface EdgeActionMenuState {
  edgeId: string;
  x: number;
  y: number;
}

function avoidWorkflowNodeOverlap(
  graph: WorkflowGraph,
  position: WorkflowNodePosition
): WorkflowNodePosition {
  let next = { ...position };
  let guard = 0;

  while (
    guard < 24 &&
    graph.nodes.some((node) => {
      const existing = node.position;
      if (!existing) return false;
      return (
        Math.abs(existing.x - next.x) < NODE_COLLISION_X &&
        Math.abs(existing.y - next.y) < NODE_COLLISION_Y
      );
    })
  ) {
    next = {
      x: next.x + 40,
      y: next.y + 120,
    };
    guard += 1;
  }

  return next;
}

function getNewWorkflowNodePosition({
  graph,
  selectedNodeId,
  requestedPosition,
}: {
  graph: WorkflowGraph;
  selectedNodeId: string | null;
  requestedPosition?: WorkflowNodePosition;
}): WorkflowNodePosition {
  if (requestedPosition) {
    return avoidWorkflowNodeOverlap(graph, requestedPosition);
  }

  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
  if (selectedNode?.position) {
    return avoidWorkflowNodeOverlap(graph, {
      x: selectedNode.position.x + NEW_NODE_OFFSET_X,
      y: selectedNode.position.y + NEW_NODE_OFFSET_Y,
    });
  }

  return avoidWorkflowNodeOverlap(graph, { x: 400, y: 160 });
}

function getWorkflowNodeBounds(graph: WorkflowGraph) {
  const positions = graph.nodes
    .map((node) => node.position)
    .filter((position): position is WorkflowNodePosition => Boolean(position));

  if (positions.length === 0) {
    return {
      minX: 120,
      minY: 160,
      maxX: 780,
      maxY: 320,
    };
  }

  return positions.reduce(
    (bounds, position) => ({
      minX: Math.min(bounds.minX, position.x),
      minY: Math.min(bounds.minY, position.y),
      maxX: Math.max(bounds.maxX, position.x),
      maxY: Math.max(bounds.maxY, position.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    }
  );
}

function getNewStickyNotePosition(graph: WorkflowGraph): WorkflowNodePosition {
  const bounds = getWorkflowNodeBounds(graph);
  return {
    x: bounds.minX,
    y: Math.max(20, bounds.minY - 170),
  };
}

function getNewStageGroupPosition(graph: WorkflowGraph): {
  position: WorkflowNodePosition;
  size: { width: number; height: number };
} {
  const bounds = getWorkflowNodeBounds(graph);
  return {
    position: {
      x: Math.max(40, bounds.minX - 50),
      y: Math.max(40, bounds.minY - 65),
    },
    size: {
      width: Math.max(520, bounds.maxX - bounds.minX + 360),
      height: Math.max(220, bounds.maxY - bounds.minY + 220),
    },
  };
}

function parsePersistedWorkflowGraph(
  graphJson: string,
  fallback: WorkflowGraph
): WorkflowGraph {
  try {
    return migrateWorkflowGraph(JSON.parse(graphJson) as WorkflowGraph);
  } catch {
    return fallback;
  }
}

function duplicateWorkflowAgentNode(
  graph: WorkflowGraph,
  node: WorkflowNode
): WorkflowNode {
  const duplicatedData = { ...node.data };
  delete duplicatedData.session_id;

  return createWorkflowNode('agent', {
    data: {
      ...duplicatedData,
      display_name: `${node.data.display_name || 'Agent Step'} copy`,
    },
    position: getNewWorkflowNodePosition({
      graph,
      selectedNodeId: null,
      requestedPosition: {
        x: (node.position?.x ?? 360) + DUPLICATE_NODE_OFFSET_X,
        y: (node.position?.y ?? 160) + DUPLICATE_NODE_OFFSET_Y,
      },
    }),
  });
}

export interface WorkflowTemplateEditorPageProps {
  projectId: string;
  workflowId: string;
}

export function WorkflowTemplateEditorPage({
  projectId,
  workflowId,
}: WorkflowTemplateEditorPageProps) {
  const { data: template, isLoading, error } = useWorkflowTemplate(workflowId);
  const { data: workflowAttempt, isLoading: isWorkflowAttemptLoading } =
    useWorkflowAttemptForWorkflow(workflowId);
  const { data: latestRun } = useWorkflowRun(workflowAttempt?.latest_run_id, {
    enabled: !!workflowAttempt?.latest_run_id,
  });
  const { updateTemplate, createTemplate, isUpdating, isCreating } =
    useWorkflowTemplateMutations();
  const { runAttempt, isRunningAttempt } = useWorkflowAttemptMutations();
  const navigation = useAppNavigation();
  const { getIssue } = useProjectContext();

  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [sessionPanelNodeId, setSessionPanelNodeId] = useState<string | null>(
    null
  );
  const [editPanelNodeId, setEditPanelNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] =
    useState<AgentStepContextMenuState | null>(null);
  const [edgeActionMenu, setEdgeActionMenu] =
    useState<EdgeActionMenuState | null>(null);
  const [edgeReconnectFocus, setEdgeReconnectFocus] = useState<
    'source' | 'target' | null
  >(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [graphParseError, setGraphParseError] = useState<string | null>(null);
  const [runStartError, setRunStartError] = useState<string | null>(null);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [validationTouched, setValidationTouched] = useState(false);
  const [staleNodeIds, setStaleNodeIds] = useState<Set<string>>(
    () => new Set()
  );
  const consumedQueuedFocusForWorkflowRef = useRef<string | null>(null);

  const isSystem = template?.source === 'system';
  const readOnly = isSystem;

  // Initialize graph from template
  useEffect(() => {
    if (template) {
      setName(template.name || '');
      setDescription(template.description || '');
      try {
        const parsed = JSON.parse(template.graph_json) as WorkflowGraph;
        if (parsed && typeof parsed === 'object' && parsed.version) {
          setGraph(migrateWorkflowGraph(parsed));
          setGraphParseError(null);
        } else {
          setGraph(createDefaultWorkflowGraph());
          setGraphParseError('Workflow graph JSON did not contain a graph.');
        }
      } catch {
        setGraph(createDefaultWorkflowGraph());
        setGraphParseError('Workflow graph JSON could not be parsed.');
      }
    }
  }, [template]);

  useEffect(() => {
    setStaleNodeIds(new Set());
  }, [workflowAttempt?.latest_run_id]);

  useEffect(() => {
    if (!graph || consumedQueuedFocusForWorkflowRef.current === workflowId) {
      return;
    }

    consumedQueuedFocusForWorkflowRef.current = workflowId;
    const queuedFocus = consumeWorkflowTemplateNodeFocus(workflowId);
    if (!queuedFocus) return;

    const focusedNode = graph.nodes.find(
      (node) => node.id === queuedFocus.nodeId
    );
    if (
      !focusedNode ||
      focusedNode.type === 'start' ||
      focusedNode.type === 'end'
    ) {
      return;
    }

    setSelectedNodeId(focusedNode.id);
    setSelectedEdgeId(null);
    setEdgeReconnectFocus(null);
    setContextMenu(null);
    setEdgeActionMenu(null);

    if (queuedFocus.panel === 'edit' && focusedNode.type === 'agent') {
      setEditPanelNodeId(focusedNode.id);
      setSessionPanelNodeId(null);
      return;
    }

    setSessionPanelNodeId(focusedNode.id);
    setEditPanelNodeId(null);
  }, [graph, workflowId]);

  const persistWorkflowGraph = async (nextGraph: WorkflowGraph) => {
    const updatedTemplate = await updateTemplate({
      workflowId,
      payload: {
        name,
        description,
        graph_json: JSON.stringify(nextGraph),
      },
    });
    const persistedGraph = parsePersistedWorkflowGraph(
      updatedTemplate.graph_json,
      nextGraph
    );
    setGraph(persistedGraph);
    return persistedGraph;
  };

  const handleSave = async () => {
    if (!graph || readOnly) return;
    await persistWorkflowGraph(graph);
  };

  const issue = workflowAttempt ? getIssue(workflowAttempt.issue_id) : null;

  const handleStartRunFromGraph = async (nextGraph: WorkflowGraph) => {
    if (!workflowAttempt || readOnly) {
      setRunStartError('This workflow is not linked to a task attempt.');
      return;
    }

    const runValidationIssues = validateWorkflowGraph(nextGraph);
    if (runValidationIssues.length > 0 || graphParseError) {
      setValidationTouched(true);
      return;
    }

    setIsStartingRun(true);
    setRunStartError(null);
    try {
      await persistWorkflowGraph(nextGraph);
      const run = await runAttempt({
        attemptId: workflowAttempt.id,
        payload: {
          workspace_id: null,
          trigger_source: 'manual',
          input_text: buildWorkflowRunInput({
            title: issue?.title ?? name,
            description: issue?.description ?? description,
          }),
        },
      });

      setStaleNodeIds(new Set());
      navigation.goToProjectWorkflowRun(projectId, run.id);
    } catch (err) {
      setRunStartError(getWorkflowRunErrorMessage(err));
    } finally {
      setIsStartingRun(false);
    }
  };

  const handleOpenLatestRun = () => {
    if (!workflowAttempt?.latest_run_id) return;
    navigation.goToProjectWorkflowRun(projectId, workflowAttempt.latest_run_id);
  };

  const handleCopy = async () => {
    if (!graph) return;
    const result = await createTemplate({
      projectId,
      payload: {
        name: `${name || 'Workflow'} (Copy)`,
        description,
        graph_json: JSON.stringify(graph),
      },
    });
    navigation.goToProjectWorkflowEdit(projectId, result.id);
  };

  const handleBack = () => {
    if (workflowAttempt) {
      navigation.goToProjectIssue(projectId, workflowAttempt.issue_id);
      return;
    }
    navigation.goToProjectWorkflows(projectId);
  };

  const addWorkflowNode = ({
    kind,
    position,
    sourceNodeId,
  }: {
    kind: WorkflowNodeKind;
    position?: WorkflowNodePosition;
    sourceNodeId: string | null;
  }) => {
    if (!graph || readOnly) return;
    const newPosition = getNewWorkflowNodePosition({
      graph,
      selectedNodeId: sourceNodeId,
      requestedPosition: position,
    });
    const newNode = createWorkflowNode(kind, { position: newPosition });
    const selectedNode = graph.nodes.find((node) => node.id === sourceNodeId);
    const shouldConnectFromSelected =
      selectedNode && selectedNode.type !== 'end' && newNode.type !== 'start';
    const nextEdges = shouldConnectFromSelected
      ? [
          ...graph.edges,
          createWorkflowEdge({
            id: `${selectedNode.id}-${newNode.id}`,
            source: selectedNode.id,
            target: newNode.id,
          }),
        ]
      : graph.edges;

    setGraph({
      ...graph,
      nodes: [...graph.nodes, newNode],
      edges: nextEdges,
    });
    setSelectedNodeId(newNode.id);
    setSelectedEdgeId(null);
    setEdgeReconnectFocus(null);
    setSessionPanelNodeId(null);
    setEditPanelNodeId(isWorkflowAgentDraftNode(newNode) ? newNode.id : null);
    setContextMenu(null);
    setEdgeActionMenu(null);
  };

  const handleAddNode = (
    kind: WorkflowNodeKind,
    position?: WorkflowNodePosition
  ) => {
    addWorkflowNode({ kind, position, sourceNodeId: selectedNodeId });
  };

  const handleAddAgentStepAfterNode = (nodeId: string) => {
    addWorkflowNode({ kind: 'agent', sourceNodeId: nodeId });
  };

  const handleOpenAgentStepEdit = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setEdgeReconnectFocus(null);
    setEditPanelNodeId(nodeId);
    setSessionPanelNodeId(null);
    setContextMenu(null);
    setEdgeActionMenu(null);
  };

  const handleGraphChange = (newGraph: WorkflowGraph) => {
    setValidationTouched(false);
    setRunStartError(null);
    setGraph(newGraph);
  };

  const handleTidyGraph = () => {
    if (!graph || readOnly) return;
    handleGraphChange(tidyWorkflowGraph(graph));
  };

  const handleAddStickyNote = () => {
    if (!graph || readOnly) return;
    setGraph({
      ...graph,
      canvas: {
        ...graph.canvas,
        notes: [
          ...(graph.canvas?.notes ?? []),
          createWorkflowCanvasStickyNote({
            title: 'Note',
            content: '记录这个阶段的目标、约束或注意事项。',
            position: getNewStickyNotePosition(graph),
          }),
        ],
      },
    });
  };

  const handleAddStageGroup = () => {
    if (!graph || readOnly) return;
    const { position, size } = getNewStageGroupPosition(graph);
    setGraph({
      ...graph,
      canvas: {
        ...graph.canvas,
        groups: [
          ...(graph.canvas?.groups ?? []),
          createWorkflowCanvasStageGroup({
            title: '新阶段',
            description: '把相关 Agent Step 放在同一阶段内。',
            position,
            size,
          }),
        ],
      },
    });
  };

  const handleNodeChange = (
    nodeId: string,
    dataUpdates: Partial<WorkflowGraph['nodes'][number]['data']>
  ) => {
    if (!graph || readOnly) return;
    setRunStartError(null);
    setGraph(applyWorkflowNodeDataPatch(graph, nodeId, dataUpdates));
  };

  const handleAgentStepEditSave = async ({
    displayName,
    prompt,
    executorConfig,
  }: WorkflowAgentStepEditValue) => {
    if (!graph || !editPanelNodeId || readOnly || isUpdating) {
      return;
    }

    const currentNode = graph.nodes.find((node) => node.id === editPanelNodeId);
    const nextGraph = applyWorkflowNodeDataPatch(graph, editPanelNodeId, {
      display_name: displayName,
      ...createWorkflowAgentNodeDraftPatch({ prompt, executorConfig }),
    });
    const nextNode = nextGraph.nodes.find(
      (node) => node.id === editPanelNodeId
    );
    const changedNextRunConfig =
      currentNode?.data.prompt_template !== nextNode?.data.prompt_template ||
      JSON.stringify(currentNode?.data.executor_config ?? null) !==
        JSON.stringify(nextNode?.data.executor_config ?? null);
    setGraph(nextGraph);
    setRunStartError(null);
    try {
      await persistWorkflowGraph(nextGraph);
      if (
        workflowAttempt?.latest_run_id &&
        changedNextRunConfig &&
        !runningNodeIds.has(editPanelNodeId)
      ) {
        setStaleNodeIds((current) => new Set(current).add(editPanelNodeId));
      }
      setEditPanelNodeId(null);
    } catch (err) {
      setRunStartError(getWorkflowRunErrorMessage(err));
    }
  };

  const handleOpenAgentSession = async (nodeId: string) => {
    if (!graph) return;
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type === 'start' || node.type === 'end') return;

    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setEdgeReconnectFocus(null);
    setContextMenu(null);
    setEdgeActionMenu(null);
    setEditPanelNodeId(null);
    setRunStartError(null);

    if (!node.data.session_id && !readOnly) {
      try {
        await persistWorkflowGraph(graph);
      } catch (err) {
        setRunStartError(getWorkflowRunErrorMessage(err));
        return;
      }
    }

    setSessionPanelNodeId(nodeId);
  };

  const handleDuplicateAgentStep = (nodeId: string) => {
    if (!graph || readOnly) return;
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type !== 'agent') return;

    const duplicate = duplicateWorkflowAgentNode(graph, node);
    setGraph({
      ...graph,
      nodes: [...graph.nodes, duplicate],
    });
    setSelectedNodeId(duplicate.id);
    setSelectedEdgeId(null);
    setEdgeReconnectFocus(null);
    setSessionPanelNodeId(null);
    setEditPanelNodeId(duplicate.id);
    setContextMenu(null);
    setEdgeActionMenu(null);
  };

  const handleDeleteAgentStep = async (nodeId: string) => {
    if (!graph || readOnly) return;
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type !== 'agent') return;

    if (node.data.session_id) {
      const result = await ConfirmDialog.show({
        title: 'Delete Agent Step',
        message:
          'This removes the step from the workflow graph. The existing session history is not copied into another step.',
        confirmText: 'Delete',
        variant: 'destructive',
      });
      if (result !== 'confirmed') return;
    }

    const nextGraph = {
      ...graph,
      nodes: graph.nodes.filter((candidate) => candidate.id !== nodeId),
      edges: graph.edges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId
      ),
    };
    setGraph(nextGraph);
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setEdgeReconnectFocus(null);
    if (sessionPanelNodeId === nodeId) setSessionPanelNodeId(null);
    if (editPanelNodeId === nodeId) setEditPanelNodeId(null);
    setContextMenu(null);
    setEdgeActionMenu(null);
    try {
      await persistWorkflowGraph(nextGraph);
    } catch (err) {
      setRunStartError(getWorkflowRunErrorMessage(err));
    }
  };

  const handleEdgeChange = (
    edgeId: string,
    updates: Partial<
      Pick<
        WorkflowEdge,
        'source' | 'target' | 'source_handle' | 'target_handle' | 'type'
      >
    >
  ) => {
    if (!graph || readOnly) return;
    let nextGraph: WorkflowGraph = {
      ...graph,
      edges: graph.edges.map((edge) =>
        edge.id === edgeId ? { ...edge, ...updates } : edge
      ),
    };

    if (updates.type === 'condition_branch') {
      const branchName =
        getConditionBranchNameForEdge(nextGraph, edgeId) ??
        getConditionBranchNamesForEdge(nextGraph, edgeId)[0];
      if (branchName) {
        nextGraph = setConditionBranchTargetForEdge(
          nextGraph,
          edgeId,
          branchName
        );
      }
    } else if (updates.type) {
      nextGraph = clearConditionBranchTargetForEdge(nextGraph, edgeId);
    }

    setValidationTouched(false);
    setGraph(nextGraph);
    setEdgeActionMenu(null);
    setEdgeReconnectFocus(null);
  };

  const handleConditionBranchChange = (edgeId: string, branchName: string) => {
    if (!graph || readOnly) return;
    setValidationTouched(false);
    setGraph(setConditionBranchTargetForEdge(graph, edgeId, branchName));
    setEdgeActionMenu(null);
    setEdgeReconnectFocus(null);
  };

  const handleDeleteEdge = (edgeId: string) => {
    if (!graph || readOnly) return;
    setValidationTouched(false);
    setRunStartError(null);
    setSelectedEdgeId(null);
    setEdgeReconnectFocus(null);
    setEdgeActionMenu(null);
    setGraph({
      ...graph,
      edges: graph.edges.filter((edge) => edge.id !== edgeId),
    });
  };

  const handleSelectEdgeForReconnect = (
    edgeId: string,
    focusField: 'source' | 'target'
  ) => {
    setSelectedNodeId(null);
    setSelectedEdgeId(edgeId);
    setEdgeReconnectFocus(focusField);
    setSessionPanelNodeId(null);
    setEditPanelNodeId(null);
    setContextMenu(null);
    setEdgeActionMenu(null);
  };

  const handleInsertAgentStepOnEdge = (edgeId: string) => {
    if (!graph || readOnly) return;
    const edge = graph.edges.find((candidate) => candidate.id === edgeId);
    if (!edge) return;
    const sourceNode = graph.nodes.find((node) => node.id === edge.source);
    const targetNode = graph.nodes.find((node) => node.id === edge.target);
    const position = avoidWorkflowNodeOverlap(graph, {
      x:
        ((sourceNode?.position?.x ?? 320) + (targetNode?.position?.x ?? 640)) /
        2,
      y:
        ((sourceNode?.position?.y ?? 160) + (targetNode?.position?.y ?? 160)) /
        2,
    });
    const insertedNode = createWorkflowNode('agent', { position });
    const firstEdge = createWorkflowEdge({
      id: `${edge.source}-${insertedNode.id}`,
      source: edge.source,
      source_handle: edge.source_handle ?? DEFAULT_SOURCE_HANDLE,
      target: insertedNode.id,
      target_handle: DEFAULT_TARGET_HANDLE,
      type: edge.type,
    });
    const secondEdge = createWorkflowEdge({
      id: `${insertedNode.id}-${edge.target}`,
      source: insertedNode.id,
      source_handle: DEFAULT_SOURCE_HANDLE,
      target: edge.target,
      target_handle: edge.target_handle ?? DEFAULT_TARGET_HANDLE,
      type: 'default',
    });
    const branchName = getConditionBranchNameForEdge(graph, edgeId);
    let nextGraph: WorkflowGraph = {
      ...graph,
      nodes: [...graph.nodes, insertedNode],
      edges: [
        ...graph.edges.filter((candidate) => candidate.id !== edgeId),
        firstEdge,
        secondEdge,
      ],
    };

    if (branchName) {
      nextGraph = setConditionBranchTargetForEdge(
        nextGraph,
        firstEdge.id,
        branchName
      );
    }

    setValidationTouched(false);
    setRunStartError(null);
    setGraph(nextGraph);
    setSelectedNodeId(insertedNode.id);
    setSelectedEdgeId(null);
    setEdgeReconnectFocus(null);
    setSessionPanelNodeId(null);
    setEditPanelNodeId(insertedNode.id);
    setContextMenu(null);
    setEdgeActionMenu(null);
  };

  const selectedNode = useMemo(
    () => graph?.nodes.find((n) => n.id === selectedNodeId) ?? null,
    [graph, selectedNodeId]
  );

  const selectedEdge = useMemo(
    () => graph?.edges.find((edge) => edge.id === selectedEdgeId) ?? null,
    [graph, selectedEdgeId]
  );

  const sessionPanelNode = useMemo(
    () => graph?.nodes.find((node) => node.id === sessionPanelNodeId) ?? null,
    [sessionPanelNodeId, graph]
  );
  const editPanelNode = useMemo(
    () => graph?.nodes.find((node) => node.id === editPanelNodeId) ?? null,
    [editPanelNodeId, graph]
  );
  const runningNodeIds = useMemo(
    () =>
      new Set(
        (latestRun?.nodes ?? [])
          .filter((node) => node.status === 'running')
          .map((node) => node.node_id)
      ),
    [latestRun?.nodes]
  );
  const nodeStatuses = useMemo(
    () => buildWorkflowNodeExecutionStatusMap(latestRun?.nodes),
    [latestRun?.nodes]
  );
  const staleNodeIdList = useMemo(
    () => Array.from(staleNodeIds),
    [staleNodeIds]
  );
  const isEditPanelNodeRunning =
    !!editPanelNode && runningNodeIds.has(editPanelNode.id);
  const editPanelHasExistingRun =
    !!workflowAttempt?.latest_run_id || !!editPanelNode?.data.session_id;
  const contextMenuNode = useMemo(
    () => graph?.nodes.find((node) => node.id === contextMenu?.nodeId) ?? null,
    [contextMenu?.nodeId, graph]
  );

  const sessionPanelExecution = useMemo<WorkflowNodeExecutionResponse | null>(
    () =>
      sessionPanelNode
        ? {
            id: `draft-${sessionPanelNode.id}`,
            run_id:
              workflowAttempt?.latest_run_id ?? workflowAttempt?.id ?? 'draft',
            node_id: sessionPanelNode.id,
            node_type: sessionPanelNode.type,
            iteration: 0n,
            status: 'pending',
            input_text:
              typeof sessionPanelNode.data.prompt_template === 'string'
                ? sessionPanelNode.data.prompt_template
                : null,
            output_text: null,
            session_id:
              typeof sessionPanelNode.data.session_id === 'string'
                ? sessionPanelNode.data.session_id
                : null,
            execution_process_id: null,
            arena_group_id: null,
            tokens_used: null,
            cost_estimate: null,
            started_at: null,
            finished_at: null,
            error_text: null,
            created_at:
              workflowAttempt?.created_at ??
              template?.created_at ??
              new Date(0).toISOString(),
            updated_at:
              workflowAttempt?.updated_at ??
              template?.updated_at ??
              new Date(0).toISOString(),
          }
        : null,
    [
      sessionPanelNode,
      template?.created_at,
      template?.updated_at,
      workflowAttempt,
    ]
  );

  const selectedEdgeConditionBranchName = useMemo(
    () =>
      graph && selectedEdge
        ? getConditionBranchNameForEdge(graph, selectedEdge.id)
        : null,
    [graph, selectedEdge]
  );

  const selectedEdgeConditionBranchNames = useMemo(
    () =>
      graph && selectedEdge
        ? getConditionBranchNamesForEdge(graph, selectedEdge.id)
        : [],
    [graph, selectedEdge]
  );

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-primary">
        <Loader2 className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }

  if (error || !template || !graph) {
    return (
      <div className="flex h-full items-center justify-center bg-primary text-error">
        Failed to load workflow:{' '}
        {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  const validationIssues = validateWorkflowGraph(graph);
  const isValid = validationIssues.length === 0 && !graphParseError;
  const canRunWorkflowAttempt =
    !!workflowAttempt &&
    !isWorkflowAttemptLoading &&
    !isStartingRun &&
    !isRunningAttempt &&
    !isUpdating &&
    isValid &&
    !readOnly;
  const inspectorPanel = getWorkflowTemplateInspectorPanel({
    selectedEdge,
    selectedNode,
    requestedAgentDraftNode: null,
  });
  const editableAgentNode =
    editPanelNode?.type === 'agent' ? editPanelNode : null;
  const isEditPanelOpen = !!editableAgentNode;
  const isWideSidePanel = Boolean(sessionPanelExecution || isEditPanelOpen);
  const workflowEditorLayout: Layout = isWideSidePanel
    ? { 'workflow-canvas': 62, 'workflow-side': 38 }
    : { 'workflow-canvas': 74, 'workflow-side': 26 };
  const workflowSidePanelKey = editableAgentNode
    ? `edit-${editableAgentNode.id}`
    : sessionPanelExecution
      ? `session-${sessionPanelExecution.node_id}`
      : inspectorPanel.kind === 'edge'
        ? `edge-${inspectorPanel.edge.id}`
        : `node-${inspectorPanel.node?.id ?? 'empty'}`;

  return (
    <div className="flex h-full flex-col bg-primary">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-secondary bg-panel p-base">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={handleBack}
            className="flex h-9 w-9 items-center justify-center p-0 transition-colors hover:bg-secondary/20"
            aria-label="Back to workflows"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex flex-col gap-0.5">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={readOnly}
              className="bg-transparent text-base font-semibold text-high outline-none transition-colors hover:text-brand focus:text-brand disabled:opacity-50"
              placeholder="Workflow Name"
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={readOnly}
              className="min-w-[280px] bg-transparent text-xs text-low outline-none transition-colors focus:text-high disabled:opacity-50"
              placeholder="Description"
            />
            {isSystem && (
              <span className="text-xs text-brand">
                System Template (Read-only)
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={readOnly}
            onClick={() => handleAddNode('agent')}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Agent Step
          </Button>
          <Button
            variant="outline"
            disabled={readOnly}
            onClick={handleTidyGraph}
            className="flex items-center gap-2"
          >
            <LayoutGrid className="h-4 w-4" />
            Tidy
          </Button>
          <Button
            variant="outline"
            disabled={readOnly}
            onClick={handleAddStickyNote}
            className="flex items-center gap-2"
          >
            <StickyNote className="h-4 w-4" />
            Note
          </Button>
          <Button
            variant="outline"
            disabled={readOnly}
            onClick={handleAddStageGroup}
            className="flex items-center gap-2"
          >
            <Ungroup className="h-4 w-4" />
            Stage
          </Button>
          <Button
            variant="outline"
            onClick={() => setValidationTouched(true)}
            className="flex items-center gap-2"
          >
            <CheckCircle2 className="h-4 w-4" />
            Validate
          </Button>
          <Button
            variant="outline"
            disabled={!canRunWorkflowAttempt}
            onClick={() => void handleStartRunFromGraph(graph)}
            className="flex items-center gap-2"
            aria-label="Run workflow attempt"
            title={
              workflowAttempt
                ? undefined
                : 'This workflow is not linked to a task attempt.'
            }
          >
            {isStartingRun || isRunningAttempt || isWorkflowAttemptLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayIcon className="h-4 w-4" />
            )}
            Run Workflow
          </Button>
          {workflowAttempt?.latest_run_id ? (
            <Button
              variant="outline"
              onClick={handleOpenLatestRun}
              className="flex items-center gap-2"
            >
              Open latest run
            </Button>
          ) : null}
          {isSystem ? (
            <Button
              onClick={handleCopy}
              disabled={isCreating}
              className="flex items-center gap-2"
            >
              {isCreating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Copy to Project
            </Button>
          ) : (
            <Button
              onClick={handleSave}
              disabled={isUpdating || !isValid}
              className="flex items-center gap-2"
            >
              {isUpdating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save
            </Button>
          )}
        </div>
      </div>

      {graphParseError ? (
        <div className="border-b border-error/30 bg-error/10 px-base py-half text-xs text-error">
          {graphParseError}
        </div>
      ) : runStartError ? (
        <div
          className="border-b border-error/30 bg-error/10 px-base py-half text-xs text-error"
          role="alert"
        >
          {runStartError}
        </div>
      ) : validationTouched && validationIssues.length > 0 ? (
        <div className="border-b border-brand/30 bg-brand/10 px-base py-half text-xs text-brand">
          Validation found {validationIssues.length} issue
          {validationIssues.length === 1 ? '' : 's'}.
        </div>
      ) : null}

      {contextMenu && contextMenuNode?.type === 'agent' ? (
        <DropdownMenu
          open
          onOpenChange={(open) => {
            if (!open) setContextMenu(null);
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Agent step actions"
              style={{
                position: 'fixed',
                left: contextMenu.x,
                top: contextMenu.y,
                width: 1,
                height: 1,
                padding: 0,
                border: 0,
                background: 'transparent',
                zIndex: 10000,
              }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" sideOffset={2}>
            <DropdownMenuItem
              onClick={() => void handleOpenAgentSession(contextMenu.nodeId)}
            >
              Open Session
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleOpenAgentStepEdit(contextMenu.nodeId)}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={readOnly}
              onClick={() => handleAddAgentStepAfterNode(contextMenu.nodeId)}
            >
              Add Next Agent Step
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={readOnly}
              onClick={() => handleDuplicateAgentStep(contextMenu.nodeId)}
            >
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem disabled>Run Step</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={readOnly}
              onClick={() => void handleDeleteAgentStep(contextMenu.nodeId)}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {edgeActionMenu && selectedEdge ? (
        <DropdownMenu
          open
          onOpenChange={(open) => {
            if (!open) setEdgeActionMenu(null);
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Workflow edge actions"
              style={{
                position: 'fixed',
                left: edgeActionMenu.x,
                top: edgeActionMenu.y,
                width: 1,
                height: 1,
                padding: 0,
                border: 0,
                background: 'transparent',
                zIndex: 10000,
              }}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" sideOffset={2}>
            <DropdownMenuItem
              disabled={readOnly}
              onClick={() => handleInsertAgentStepOnEdge(edgeActionMenu.edgeId)}
            >
              Insert Agent Step
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                handleSelectEdgeForReconnect(edgeActionMenu.edgeId, 'source')
              }
            >
              Reconnect Source
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                handleSelectEdgeForReconnect(edgeActionMenu.edgeId, 'target')
              }
            >
              Reconnect Target
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={readOnly}
              onClick={() => handleDeleteEdge(edgeActionMenu.edgeId)}
            >
              Delete Edge
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Group
        orientation="horizontal"
        className="min-h-0 flex-1 overflow-hidden"
        defaultLayout={workflowEditorLayout}
      >
        <Panel
          id="workflow-canvas"
          minSize="35%"
          className="min-w-0 overflow-hidden"
        >
          <div className="relative flex h-full min-h-0 flex-col">
            <div className="relative min-h-0 flex-1">
              <ReactFlowProvider>
                <WorkflowCanvas
                  graph={graph}
                  validationIssues={validationIssues}
                  nodeStatuses={nodeStatuses}
                  staleNodeIds={staleNodeIdList}
                  readOnly={readOnly}
                  onChange={handleGraphChange}
                  onSelectionChange={(selection) => {
                    setSelectedNodeId(selection.nodeId);
                    setSelectedEdgeId(selection.edgeId);
                    setEdgeReconnectFocus(null);
                    setContextMenu(null);
                    setEdgeActionMenu(null);
                    setSessionPanelNodeId((currentPanelNodeId) =>
                      selection.edgeId ||
                      selection.nodeId !== currentPanelNodeId
                        ? null
                        : currentPanelNodeId
                    );
                    setEditPanelNodeId((currentPanelNodeId) =>
                      selection.edgeId ||
                      selection.nodeId !== currentPanelNodeId
                        ? null
                        : currentPanelNodeId
                    );
                  }}
                  onNodeDrop={handleAddNode}
                  onNodeOpen={(nodeId) => void handleOpenAgentSession(nodeId)}
                  onNodeEdit={handleOpenAgentStepEdit}
                  onNodeAddNext={handleAddAgentStepAfterNode}
                  onNodeDuplicate={handleDuplicateAgentStep}
                  onNodeDelete={(nodeId) => void handleDeleteAgentStep(nodeId)}
                  onNodeContextMenu={(event) => {
                    const node = graph.nodes.find(
                      (candidate) => candidate.id === event.nodeId
                    );
                    setEdgeActionMenu(null);
                    setContextMenu(node?.type === 'agent' ? event : null);
                  }}
                  onEdgeActionMenu={(event) => {
                    setSelectedNodeId(null);
                    setSelectedEdgeId(event.edgeId);
                    setEdgeReconnectFocus(null);
                    setSessionPanelNodeId(null);
                    setEditPanelNodeId(null);
                    setContextMenu(null);
                    setEdgeActionMenu(event);
                  }}
                />
              </ReactFlowProvider>
            </div>
            <WorkflowValidationPanel graph={graph} />
          </div>
        </Panel>

        <Separator
          id="workflow-editor-separator"
          className="w-1 cursor-col-resize bg-panel outline-none transition-colors hover:bg-brand/50"
        />

        <Panel
          id="workflow-side"
          minSize="320px"
          maxSize="760px"
          className="relative z-10 min-w-0 overflow-hidden border-l border-secondary bg-panel shadow-[-8px_0_18px_rgba(15,23,42,0.06)]"
        >
          <div
            key={workflowSidePanelKey}
            className="workflow-side-panel-content h-full min-h-0"
          >
            {editableAgentNode ? (
              <WorkflowAgentStepEditPanel
                key={editableAgentNode.id}
                node={editableAgentNode}
                readOnly={readOnly}
                isSaving={isUpdating}
                isRunning={isEditPanelNodeRunning}
                hasExistingRun={editPanelHasExistingRun}
                error={runStartError}
                onClose={() => setEditPanelNodeId(null)}
                onSave={(value) => void handleAgentStepEditSave(value)}
              />
            ) : sessionPanelExecution ? (
              <div
                data-testid="workflow-node-conversation-panel"
                className="h-full overflow-hidden"
              >
                <WorkflowNodeSessionPanel
                  execution={sessionPanelExecution}
                  workspaceId={workflowAttempt?.workspace_id ?? null}
                  sessionHref={null}
                  workspaceHref={null}
                  nodeTitle={sessionPanelNode?.data.display_name}
                  nodeData={sessionPanelNode?.data ?? null}
                  statusLabel="Draft"
                  onEditConfig={() => {
                    if (sessionPanelNodeId) {
                      handleOpenAgentStepEdit(sessionPanelNodeId);
                    }
                  }}
                  runStepDisabled
                  runStepTitle="Run the workflow to execute this step."
                />
              </div>
            ) : inspectorPanel.kind === 'edge' ? (
              <WorkflowEdgeInspector
                edge={inspectorPanel.edge}
                nodes={graph.nodes}
                conditionBranchName={selectedEdgeConditionBranchName}
                conditionBranchNames={selectedEdgeConditionBranchNames}
                focusField={edgeReconnectFocus}
                readOnly={readOnly}
                onChange={handleEdgeChange}
                onConditionBranchChange={handleConditionBranchChange}
                onDelete={handleDeleteEdge}
              />
            ) : (
              <WorkflowNodeInspector
                node={inspectorPanel.node}
                readOnly={readOnly}
                onChange={handleNodeChange}
              />
            )}
          </div>
        </Panel>
      </Group>
    </div>
  );
}
