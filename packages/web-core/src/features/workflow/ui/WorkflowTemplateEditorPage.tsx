import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  createWorkflowCanvasStageGroup,
  createWorkflowCanvasStickyNote,
  createDefaultWorkflowGraph,
  createWorkflowEdge,
  createWorkflowNode,
  DEFAULT_SOURCE_HANDLE,
  DEFAULT_TARGET_HANDLE,
  migrateWorkflowGraph,
  normalizeConditionEdgeTypes,
  syncConditionBranches,
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
import {
  deleteIssueWorkflowAttemptDraft,
  parseIssueWorkflowAttemptDraftRouteId,
  readIssueWorkflowAttemptDraft,
  saveIssueWorkflowAttemptDraft,
  type IssueWorkflowAttemptDraft,
} from '../model/workflowAttemptDraftStorage';
import { consumeWorkflowTemplateNodeFocus } from '../model/workflowTemplateNodeFocus';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { WorkflowCanvas } from './WorkflowCanvas';
import { WorkflowNodePalette } from './WorkflowNodePalette';
import { WORKFLOW_CANVAS_CLASS_NAMES } from './workflowCanvasTokens';
import {
  WorkflowAgentStepEditPanel,
  type WorkflowAgentStepEditValue,
} from './WorkflowAgentStepEditPanel';
import { WorkflowNodeSessionPanel } from './WorkflowNodeSessionPanel';
import { WorkflowEdgeInspector } from './WorkflowEdgeInspector';
import { WorkflowNodeInspector } from './WorkflowNodeInspector';
import { WorkflowRouterConfigPanel } from './WorkflowRouterConfigPanel';
import { useWorkflowRepositorySelection } from './useWorkflowRepositorySelection';
import {
  getWorkflowDefaultGraphLabels,
  getWorkflowDefaultNodeData,
} from './workflowI18n';
import {
  applyWorkflowNodeDataPatch,
  getWorkflowTemplateInspectorPanel,
  shouldKeepRouterConfigPanelForSelection,
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
  CheckCircle2,
  LayoutGrid,
  Play as PlayIcon,
  GitBranch,
  StickyNote,
  Ungroup,
} from 'lucide-react';
import { ReactFlowProvider } from '@xyflow/react';
import { Group, type Layout, Panel, Separator } from 'react-resizable-panels';
import type {
  DraftWorkspaceRepo,
  ExecutorConfig,
  WorkflowNodeExecutionResponse,
} from 'shared/types';
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

interface NodeContextMenuState {
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

function duplicateWorkflowNode(
  graph: WorkflowGraph,
  node: WorkflowNode,
  fallbackName: string,
  copySuffix: string
): WorkflowNode {
  const duplicatedData = { ...node.data };
  delete duplicatedData.session_id;
  if (Array.isArray(duplicatedData.branches)) {
    duplicatedData.branches = [];
  }

  return createWorkflowNode(node.type, {
    data: {
      ...duplicatedData,
      display_name: `${node.data.display_name || fallbackName} ${copySuffix}`,
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
  const { t } = useTranslation('common');
  const localDraftId = parseIssueWorkflowAttemptDraftRouteId(workflowId);
  const isLocalDraft = localDraftId !== null;
  const [localDraft, setLocalDraft] =
    useState<IssueWorkflowAttemptDraft | null>(() =>
      localDraftId ? readIssueWorkflowAttemptDraft(localDraftId) : null
    );
  const {
    data: loadedTemplate,
    isLoading,
    error,
  } = useWorkflowTemplate(workflowId, { enabled: !isLocalDraft });
  const { data: workflowAttempt, isLoading: isWorkflowAttemptLoading } =
    useWorkflowAttemptForWorkflow(workflowId, { enabled: !isLocalDraft });
  const { data: latestRun } = useWorkflowRun(workflowAttempt?.latest_run_id, {
    enabled: !!workflowAttempt?.latest_run_id,
  });
  const { updateTemplate, createTemplate, isUpdating, isCreating } =
    useWorkflowTemplateMutations();
  const { createAttempt, isCreatingAttempt, runAttempt, isRunningAttempt } =
    useWorkflowAttemptMutations();
  const navigation = useAppNavigation();
  const { getIssue } = useProjectContext();

  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [sessionPanelNodeId, setSessionPanelNodeId] = useState<string | null>(
    null
  );
  const [editPanelNodeId, setEditPanelNodeId] = useState<string | null>(null);
  const [isRouterConfigPanelOpen, setIsRouterConfigPanelOpen] = useState(false);
  const pendingRouterPromptNodeIdRef = useRef<string | null>(null);
  const [contextMenu, setContextMenu] = useState<NodeContextMenuState | null>(
    null
  );
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
  const template = useMemo(
    () =>
      localDraft
        ? {
            id: workflowId,
            source: 'project' as const,
            project_id: projectId,
            name: localDraft.name,
            description: localDraft.issueDescription ?? null,
            graph_json: localDraft.graphJson,
            created_at: localDraft.createdAt,
            updated_at: localDraft.createdAt,
          }
        : loadedTemplate,
    [loadedTemplate, localDraft, projectId, workflowId]
  );
  const draftIssue = localDraft ? getIssue(localDraft.issueId) : null;
  const issue = workflowAttempt
    ? getIssue(workflowAttempt.issue_id)
    : draftIssue;
  const { selectWorkflowRepositories } = useWorkflowRepositorySelection({
    projectId,
    issueId: workflowAttempt?.issue_id ?? localDraft?.issueId ?? '',
    issueTitle: issue?.title ?? localDraft?.issueTitle ?? name,
  });
  const formatWorkflowRunError = (err: unknown) =>
    getWorkflowRunErrorMessage(err, {
      repositoryMessage: t('workflow.errors.repositoryRequired'),
      fallbackMessage: t('workflow.errors.startFailed'),
    });
  const defaultGraphLabels = useMemo(
    () => getWorkflowDefaultGraphLabels(t),
    [t]
  );

  useEffect(() => {
    setLocalDraft(
      localDraftId ? readIssueWorkflowAttemptDraft(localDraftId) : null
    );
  }, [localDraftId]);

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
          setGraph(createDefaultWorkflowGraph(defaultGraphLabels));
          setGraphParseError(t('workflow.errors.invalidGraph'));
        }
      } catch {
        setGraph(createDefaultWorkflowGraph(defaultGraphLabels));
        setGraphParseError(t('workflow.errors.parseGraphFailed'));
      }
    }
  }, [defaultGraphLabels, t, template]);

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
    if (isLocalDraft && localDraft) {
      const nextDraft = {
        ...localDraft,
        name,
        graphJson: JSON.stringify(nextGraph),
      };
      saveIssueWorkflowAttemptDraft(nextDraft);
      setLocalDraft(nextDraft);
      setGraph(nextGraph);
      return nextGraph;
    }

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

  const createAttemptFromLocalDraft = async (nextGraph: WorkflowGraph) => {
    if (!localDraft || !localDraftId) return null;

    let repos = localDraft.repos;
    if (repos.length === 0) {
      const selectedRepos = await selectWorkflowRepositories();
      if (!selectedRepos) {
        return null;
      }
      repos = selectedRepos;
    }

    const attempt = await createAttempt({
      projectId,
      issueId: localDraft.issueId,
      payload: {
        name,
        graph_json: JSON.stringify(nextGraph),
        repos,
      },
    });

    deleteIssueWorkflowAttemptDraft(localDraftId);
    navigation.goToProjectWorkflowEdit(projectId, attempt.workflow_id, {
      replace: true,
    });
    return attempt;
  };

  const handleSave = async () => {
    if (!graph || readOnly) return;
    if (isLocalDraft) {
      await createAttemptFromLocalDraft(graph);
      return;
    }
    await persistWorkflowGraph(graph);
  };

  const closeRouterConfigPanel = () => {
    pendingRouterPromptNodeIdRef.current = null;
    setIsRouterConfigPanelOpen(false);
  };

  const openRouterConfigPanel = () => {
    pendingRouterPromptNodeIdRef.current = null;
    setIsRouterConfigPanelOpen(true);
    setSelectedEdgeId(null);
    setEdgeReconnectFocus(null);
    setSessionPanelNodeId(null);
    setEditPanelNodeId(null);
    setContextMenu(null);
    setEdgeActionMenu(null);
  };

  const handleRouterConfigSave = async (executorConfig: ExecutorConfig) => {
    if (!graph || readOnly || isUpdating) return;
    const nextGraph = {
      ...graph,
      router_executor_config: executorConfig,
    };
    setRunStartError(null);
    setGraph(nextGraph);
    try {
      await persistWorkflowGraph(nextGraph);
      closeRouterConfigPanel();
    } catch (err) {
      setRunStartError(formatWorkflowRunError(err));
    }
  };

  const handleStartRunFromGraph = async (nextGraph: WorkflowGraph) => {
    if (isLocalDraft) {
      setRunStartError(t('workflow.errors.saveBeforeRun'));
      return;
    }

    if (!workflowAttempt || readOnly) {
      setRunStartError(t('workflow.errors.notLinkedToAttempt'));
      return;
    }

    const runValidationIssues = validateWorkflowGraph(nextGraph, {
      includeRunReadiness: true,
    });
    if (runValidationIssues.length > 0 || graphParseError) {
      setValidationTouched(true);
      return;
    }

    setIsStartingRun(true);
    setRunStartError(null);
    try {
      let repoOverrides: DraftWorkspaceRepo[] = [];
      if (!workflowAttempt.workspace_id) {
        const selectedRepos = await selectWorkflowRepositories();
        if (!selectedRepos) {
          return;
        }
        repoOverrides = selectedRepos;
      }

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
          repos: repoOverrides,
        },
      });

      setStaleNodeIds(new Set());
      navigation.goToProjectWorkflowRun(projectId, run.id);
    } catch (err) {
      setRunStartError(formatWorkflowRunError(err));
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
        name: t('workflow.editor.copyName', {
          name: name || t('workflow.templates.newWorkflowName'),
        }),
        description,
        graph_json: JSON.stringify(graph),
      },
    });
    navigation.goToProjectWorkflowEdit(projectId, result.id);
  };

  const handleBack = () => {
    if (localDraft) {
      deleteIssueWorkflowAttemptDraft(localDraft.id);
      navigation.goToProjectIssue(projectId, localDraft.issueId);
      return;
    }
    if (workflowAttempt) {
      navigation.goToProjectIssue(projectId, workflowAttempt.issue_id);
      return;
    }
    navigation.goToProjectWorkflows(projectId);
  };

  const addWorkflowNode = ({
    kind,
    position,
  }: {
    kind: WorkflowNodeKind;
    position?: WorkflowNodePosition;
  }) => {
    if (!graph || readOnly) return;
    const newPosition = getNewWorkflowNodePosition({
      graph,
      selectedNodeId: null,
      requestedPosition: position,
    });
    const newNode = createWorkflowNode(kind, {
      position: newPosition,
      data: getWorkflowDefaultNodeData(kind, t),
    });

    const nextGraph = syncConditionBranches({
      ...graph,
      nodes: [...graph.nodes, newNode],
    });
    setGraph(nextGraph);
    setSelectedNodeId(newNode.id);
    setSelectedEdgeId(null);
    setEdgeReconnectFocus(null);
    setSessionPanelNodeId(null);
    const shouldPromptForRouter =
      kind === 'condition' && !nextGraph.router_executor_config;
    pendingRouterPromptNodeIdRef.current = shouldPromptForRouter
      ? newNode.id
      : null;
    setIsRouterConfigPanelOpen(shouldPromptForRouter);
    setEditPanelNodeId(
      !shouldPromptForRouter && isWorkflowAgentDraftNode(newNode)
        ? newNode.id
        : null
    );
    setContextMenu(null);
    setEdgeActionMenu(null);
  };

  const handleAddNode = (
    kind: WorkflowNodeKind,
    position?: WorkflowNodePosition
  ) => {
    addWorkflowNode({ kind, position });
  };

  const handleOpenNodeEdit = (nodeId: string) => {
    const node = graph?.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type === 'start' || node.type === 'end') return;
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setEdgeReconnectFocus(null);
    setEditPanelNodeId(node.type === 'agent' ? nodeId : null);
    setSessionPanelNodeId(null);
    closeRouterConfigPanel();
    setContextMenu(null);
    setEdgeActionMenu(null);
  };

  const handleGraphChange = (newGraph: WorkflowGraph) => {
    setValidationTouched(false);
    setRunStartError(null);
    setGraph(
      syncConditionBranches(
        normalizeConditionEdgeTypes(newGraph),
        graph ?? undefined
      )
    );
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
            title: t('workflow.defaultGraph.noteTitle'),
            content: t('workflow.defaultGraph.noteContent'),
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
            title: t('workflow.defaultGraph.newStageTitle'),
            description: t('workflow.defaultGraph.newStageDescription'),
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

    const persistedGraph = template?.graph_json
      ? parsePersistedWorkflowGraph(template.graph_json, graph)
      : graph;
    const currentNode = persistedGraph.nodes.find(
      (node) => node.id === editPanelNodeId
    );
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
      setRunStartError(formatWorkflowRunError(err));
    }
  };

  const handleOpenAgentSession = async (nodeId: string) => {
    if (!graph) return;
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type !== 'agent') return;

    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
    setEdgeReconnectFocus(null);
    setContextMenu(null);
    setEdgeActionMenu(null);
    setEditPanelNodeId(null);
    closeRouterConfigPanel();
    setRunStartError(null);

    if (isLocalDraft) {
      setRunStartError(t('workflow.errors.saveBeforeSession'));
      return;
    }

    if (!node.data.session_id && !readOnly) {
      try {
        await persistWorkflowGraph(graph);
      } catch (err) {
        setRunStartError(formatWorkflowRunError(err));
        return;
      }
    }

    setSessionPanelNodeId(nodeId);
  };

  const handleDuplicateNode = (nodeId: string) => {
    if (!graph || readOnly) return;
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type === 'start' || node.type === 'end') return;

    const duplicate = duplicateWorkflowNode(
      graph,
      node,
      String(
        node.data.display_name ??
          getWorkflowDefaultNodeData(node.type, t).display_name ??
          node.type
      ),
      t('workflow.editor.copySuffix')
    );
    setGraph({
      ...graph,
      nodes: [...graph.nodes, duplicate],
    });
    setSelectedNodeId(duplicate.id);
    setSelectedEdgeId(null);
    setEdgeReconnectFocus(null);
    setSessionPanelNodeId(null);
    setEditPanelNodeId(
      isWorkflowAgentDraftNode(duplicate) ? duplicate.id : null
    );
    closeRouterConfigPanel();
    setContextMenu(null);
    setEdgeActionMenu(null);
  };

  const handleDeleteNode = async (nodeId: string) => {
    if (!graph || readOnly) return;
    const node = graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || node.type === 'start' || node.type === 'end') return;

    if (node.type === 'agent' && node.data.session_id) {
      const result = await ConfirmDialog.show({
        title: t('workflow.editor.deleteAgentStepTitle'),
        message: t('workflow.editor.deleteAgentStepMessage'),
        confirmText: t('buttons.delete'),
        variant: 'destructive',
      });
      if (result !== 'confirmed') return;
    }

    const nextGraph = syncConditionBranches(
      {
        ...graph,
        nodes: graph.nodes.filter((candidate) => candidate.id !== nodeId),
        edges: graph.edges.filter(
          (edge) => edge.source !== nodeId && edge.target !== nodeId
        ),
      },
      graph
    );
    setGraph(nextGraph);
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setEdgeReconnectFocus(null);
    if (sessionPanelNodeId === nodeId) setSessionPanelNodeId(null);
    if (editPanelNodeId === nodeId) setEditPanelNodeId(null);
    closeRouterConfigPanel();
    setStaleNodeIds((current) => {
      if (!current.has(nodeId)) return current;
      const next = new Set(current);
      next.delete(nodeId);
      return next;
    });
    setContextMenu(null);
    setEdgeActionMenu(null);
    try {
      await persistWorkflowGraph(nextGraph);
    } catch (err) {
      setRunStartError(formatWorkflowRunError(err));
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
    const nextGraph = syncConditionBranches(
      normalizeConditionEdgeTypes({
        ...graph,
        edges: graph.edges.map((edge) =>
          edge.id === edgeId ? { ...edge, ...updates } : edge
        ),
      }),
      graph
    );

    setValidationTouched(false);
    setGraph(nextGraph);
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
    setGraph(
      syncConditionBranches(
        {
          ...graph,
          edges: graph.edges.filter((edge) => edge.id !== edgeId),
        },
        graph
      )
    );
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
    closeRouterConfigPanel();
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
    const insertedNode = createWorkflowNode('agent', {
      position,
      data: getWorkflowDefaultNodeData('agent', t),
    });
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
    const previousBranch = sourceNode?.data.branches?.find(
      (branch) => branch.target_node_id === edge.target
    );
    const nextGraph = syncConditionBranches(
      normalizeConditionEdgeTypes({
        ...graph,
        nodes: [...graph.nodes, insertedNode],
        edges: [
          ...graph.edges.filter((candidate) => candidate.id !== edgeId),
          firstEdge,
          secondEdge,
        ],
      }),
      graph
    );
    const syncedBranches = nextGraph.nodes.find(
      (node) => node.id === edge.source
    )?.data.branches;
    const branchGraph =
      sourceNode?.type === 'condition' && previousBranch && syncedBranches
        ? applyWorkflowNodeDataPatch(nextGraph, edge.source, {
            branches: syncedBranches.map((branch) =>
              branch.target_node_id === insertedNode.id
                ? {
                    ...branch,
                    id: previousBranch.id ?? branch.id,
                    condition: previousBranch.condition ?? branch.condition,
                  }
                : branch
            ),
          })
        : nextGraph;

    setValidationTouched(false);
    setRunStartError(null);
    setGraph(branchGraph);
    setSelectedNodeId(insertedNode.id);
    setSelectedEdgeId(null);
    setEdgeReconnectFocus(null);
    setSessionPanelNodeId(null);
    setEditPanelNodeId(insertedNode.id);
    setIsRouterConfigPanelOpen(false);
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

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-primary">
        <Loader2 className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }

  if (error || !template || !graph) {
    const message =
      error instanceof Error
        ? error.message
        : error
          ? String(error)
          : t('workflow.errors.draftMissing');
    return (
      <div className="flex h-full items-center justify-center bg-primary text-error">
        {t('workflow.editor.loadFailed', {
          message,
        })}
      </div>
    );
  }

  const validationIssues = validateWorkflowGraph(graph, {
    includeRunReadiness: true,
  });
  const draftValidationIssues = validateWorkflowGraph(graph, {
    includeRunReadiness: false,
  });
  const isValid = draftValidationIssues.length === 0 && !graphParseError;
  const isRunReady = validationIssues.length === 0 && !graphParseError;
  const canRunWorkflowAttempt =
    !!workflowAttempt &&
    !isWorkflowAttemptLoading &&
    !isStartingRun &&
    !isRunningAttempt &&
    !isUpdating &&
    !isLocalDraft &&
    isRunReady &&
    !readOnly;
  const inspectorPanel = getWorkflowTemplateInspectorPanel({
    selectedEdge,
    selectedNode,
    requestedAgentDraftNode: null,
  });
  const editableAgentNode =
    editPanelNode?.type === 'agent' ? editPanelNode : null;
  const isEditPanelOpen = !!editableAgentNode;
  const isWideSidePanel = Boolean(
    sessionPanelExecution || isEditPanelOpen || isRouterConfigPanelOpen
  );
  const workflowEditorLayout: Layout = isWideSidePanel
    ? { 'workflow-canvas': 62, 'workflow-side': 38 }
    : { 'workflow-canvas': 74, 'workflow-side': 26 };
  const workflowSidePanelKey = isRouterConfigPanelOpen
    ? 'router-config'
    : editableAgentNode
      ? `edit-${editableAgentNode.id}`
      : sessionPanelExecution
        ? `session-${sessionPanelExecution.node_id}`
        : inspectorPanel.kind === 'edge'
          ? `edge-${inspectorPanel.edge.id}`
          : `node-${inspectorPanel.node?.id ?? 'empty'}`;

  return (
    <div className="workflow-canvas-shell flex h-full flex-col bg-primary">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-secondary bg-panel p-base">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={handleBack}
            className="flex h-9 w-9 items-center justify-center p-0 transition-colors hover:bg-secondary/20"
            aria-label={t('workflow.editor.backToWorkflows')}
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
              placeholder={t('workflow.editor.workflowNamePlaceholder')}
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={readOnly}
              className="min-w-[280px] bg-transparent text-xs text-low outline-none transition-colors focus:text-high disabled:opacity-50"
              placeholder={t('workflow.editor.descriptionPlaceholder')}
            />
            {isSystem && (
              <span className="text-xs text-brand">
                {t('workflow.editor.systemTemplateReadOnly')}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={readOnly}
            onClick={handleTidyGraph}
            className="flex items-center gap-2"
          >
            <LayoutGrid className="h-4 w-4" />
            {t('workflow.editor.tidy')}
          </Button>
          <Button
            variant="outline"
            disabled={readOnly}
            onClick={handleAddStickyNote}
            className="flex items-center gap-2"
          >
            <StickyNote className="h-4 w-4" />
            {t('workflow.editor.note')}
          </Button>
          <Button
            variant="outline"
            disabled={readOnly}
            onClick={handleAddStageGroup}
            className="flex items-center gap-2"
          >
            <Ungroup className="h-4 w-4" />
            {t('workflow.editor.stage')}
          </Button>
          <Button
            variant="outline"
            disabled={readOnly}
            onClick={openRouterConfigPanel}
            className="flex items-center gap-2"
          >
            <GitBranch className="h-4 w-4" />
            {t('workflow.router.toolbar', {
              defaultValue: 'Router',
            })}
          </Button>
          <Button
            variant="outline"
            onClick={() => setValidationTouched(true)}
            className="flex items-center gap-2"
          >
            <CheckCircle2 className="h-4 w-4" />
            {t('workflow.editor.validate')}
          </Button>
          <Button
            variant="outline"
            disabled={!canRunWorkflowAttempt}
            onClick={() => void handleStartRunFromGraph(graph)}
            className="flex items-center gap-2"
            aria-label={t('workflow.editor.runAttempt')}
            title={
              workflowAttempt
                ? undefined
                : isLocalDraft
                  ? t('workflow.errors.saveBeforeRun')
                  : t('workflow.errors.notLinkedToAttempt')
            }
          >
            {isStartingRun || isRunningAttempt || isWorkflowAttemptLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayIcon className="h-4 w-4" />
            )}
            {t('workflow.editor.runWorkflow')}
          </Button>
          {workflowAttempt?.latest_run_id ? (
            <Button
              variant="outline"
              onClick={handleOpenLatestRun}
              className="flex items-center gap-2"
            >
              {t('workflow.editor.openLatestRun')}
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
              {t('workflow.editor.copyToProject')}
            </Button>
          ) : (
            <Button
              onClick={handleSave}
              disabled={isUpdating || isCreatingAttempt || !isValid}
              className="flex items-center gap-2"
            >
              {isUpdating || isCreatingAttempt ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {t('buttons.save')}
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
          {t('workflow.editor.validationFound', {
            count: validationIssues.length,
          })}
        </div>
      ) : null}

      {contextMenu &&
      contextMenuNode &&
      contextMenuNode.type !== 'start' &&
      contextMenuNode.type !== 'end' ? (
        <DropdownMenu
          open
          onOpenChange={(open) => {
            if (!open) setContextMenu(null);
          }}
        >
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('workflow.editor.nodeActions', {
                defaultValue: 'Node actions',
              })}
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
              disabled={contextMenuNode.type !== 'agent'}
              onClick={() => void handleOpenAgentSession(contextMenu.nodeId)}
            >
              {t('workflow.editor.openSession')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => handleOpenNodeEdit(contextMenu.nodeId)}
            >
              {t('buttons.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={readOnly}
              onClick={() => handleDuplicateNode(contextMenu.nodeId)}
            >
              {t('workflow.editor.duplicate')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled>
              {t('workflow.editor.runStep')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={readOnly}
              onClick={() => void handleDeleteNode(contextMenu.nodeId)}
            >
              {t('buttons.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {edgeActionMenu && selectedEdge ? (
        <div
          role="menu"
          aria-label={t('workflow.editor.edgeActions')}
          className="workflow-popover-surface fixed z-[10000] min-w-44 rounded-sm border py-half text-high shadow-md"
          style={{
            left: edgeActionMenu.x,
            top: edgeActionMenu.y + 2,
          }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={readOnly}
            className="mx-half flex w-[calc(100%-8px)] cursor-pointer items-center rounded-sm px-base py-half text-left text-sm outline-none transition-colors hover:bg-secondary focus:bg-secondary disabled:pointer-events-none disabled:opacity-50"
            onClick={() => handleInsertAgentStepOnEdge(edgeActionMenu.edgeId)}
          >
            {t('workflow.editor.insertAgentStep')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="mx-half flex w-[calc(100%-8px)] cursor-pointer items-center rounded-sm px-base py-half text-left text-sm outline-none transition-colors hover:bg-secondary focus:bg-secondary"
            onClick={() =>
              handleSelectEdgeForReconnect(edgeActionMenu.edgeId, 'source')
            }
          >
            {t('workflow.editor.reconnectSource')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="mx-half flex w-[calc(100%-8px)] cursor-pointer items-center rounded-sm px-base py-half text-left text-sm outline-none transition-colors hover:bg-secondary focus:bg-secondary"
            onClick={() =>
              handleSelectEdgeForReconnect(edgeActionMenu.edgeId, 'target')
            }
          >
            {t('workflow.editor.reconnectTarget')}
          </button>
          <div className="-mx-1 my-1 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            disabled={readOnly}
            className="mx-half flex w-[calc(100%-8px)] cursor-pointer items-center rounded-sm px-base py-half text-left text-sm text-error outline-none transition-colors hover:bg-secondary focus:bg-secondary disabled:pointer-events-none disabled:opacity-50"
            onClick={() => handleDeleteEdge(edgeActionMenu.edgeId)}
          >
            {t('workflow.editor.deleteEdge')}
          </button>
        </div>
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
          <div className="relative flex h-full min-h-0 overflow-hidden">
            <WorkflowNodePalette
              readOnly={readOnly}
              onSelect={(kind) => handleAddNode(kind)}
            />
            <div className="relative flex min-w-0 flex-1 flex-col">
              <div className="relative min-h-0 flex-1">
                <ReactFlowProvider>
                  <WorkflowCanvas
                    graph={graph}
                    validationIssues={validationIssues}
                    nodeStatuses={nodeStatuses}
                    staleNodeIds={staleNodeIdList}
                    selectedNodeId={selectedNodeId}
                    selectedEdgeId={selectedEdgeId}
                    readOnly={readOnly}
                    onChange={handleGraphChange}
                    onSelectionChange={(selection) => {
                      setSelectedNodeId(selection.nodeId);
                      setSelectedEdgeId(selection.edgeId);
                      setEdgeReconnectFocus(null);
                      const shouldKeepRouterConfigPanel =
                        shouldKeepRouterConfigPanelForSelection({
                          pendingRouterPromptNodeId:
                            pendingRouterPromptNodeIdRef.current,
                          selectedNodeId: selection.nodeId,
                          selectedEdgeId: selection.edgeId,
                        });
                      if (
                        (selection.nodeId || selection.edgeId) &&
                        !shouldKeepRouterConfigPanel
                      ) {
                        closeRouterConfigPanel();
                      }
                      setContextMenu(null);
                      setEdgeActionMenu((currentMenu) =>
                        currentMenu &&
                        selection.edgeId === currentMenu.edgeId &&
                        !selection.nodeId
                          ? currentMenu
                          : null
                      );
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
                    onNodeEdit={handleOpenNodeEdit}
                    onNodeDuplicate={handleDuplicateNode}
                    onNodeDelete={(nodeId) => void handleDeleteNode(nodeId)}
                    onNodeContextMenu={(event) => {
                      const node = graph.nodes.find(
                        (candidate) => candidate.id === event.nodeId
                      );
                      closeRouterConfigPanel();
                      setEdgeActionMenu(null);
                      setContextMenu(
                        node && node.type !== 'start' && node.type !== 'end'
                          ? event
                          : null
                      );
                    }}
                    onEdgeActionMenu={(event) => {
                      setSelectedNodeId(null);
                      setSelectedEdgeId(event.edgeId);
                      setEdgeReconnectFocus(null);
                      setSessionPanelNodeId(null);
                      setEditPanelNodeId(null);
                      closeRouterConfigPanel();
                      setContextMenu(null);
                      setEdgeActionMenu(event);
                    }}
                  />
                </ReactFlowProvider>
              </div>
              <WorkflowValidationPanel graph={graph} />
            </div>
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
          className={WORKFLOW_CANVAS_CLASS_NAMES.sidePanel}
        >
          <div
            key={workflowSidePanelKey}
            className="workflow-side-panel-content h-full min-h-0"
          >
            {isRouterConfigPanelOpen ? (
              <WorkflowRouterConfigPanel
                routerExecutorConfig={graph.router_executor_config}
                readOnly={readOnly}
                isSaving={isUpdating}
                error={runStartError}
                onClose={closeRouterConfigPanel}
                onSave={(executorConfig) =>
                  void handleRouterConfigSave(executorConfig)
                }
              />
            ) : editableAgentNode ? (
              <WorkflowAgentStepEditPanel
                key={editableAgentNode.id}
                node={editableAgentNode}
                readOnly={readOnly}
                isSaving={isUpdating}
                isRunning={isEditPanelNodeRunning}
                hasExistingRun={editPanelHasExistingRun}
                error={runStartError}
                onClose={() => setEditPanelNodeId(null)}
                onExecutorConfigChange={(executorConfig) =>
                  handleNodeChange(editableAgentNode.id, {
                    executor_config: executorConfig,
                  })
                }
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
                  statusLabel={t('attempts.status.draft')}
                  onEditConfig={() => {
                    if (sessionPanelNodeId) {
                      handleOpenNodeEdit(sessionPanelNodeId);
                    }
                  }}
                  runStepDisabled
                  runStepTitle={t('workflow.editor.runWorkflowToExecuteStep')}
                />
              </div>
            ) : inspectorPanel.kind === 'edge' ? (
              <WorkflowEdgeInspector
                edge={inspectorPanel.edge}
                nodes={graph.nodes}
                focusField={edgeReconnectFocus}
                readOnly={readOnly}
                onChange={handleEdgeChange}
                onDelete={handleDeleteEdge}
              />
            ) : (
              <WorkflowNodeInspector
                node={inspectorPanel.node}
                graph={graph}
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
