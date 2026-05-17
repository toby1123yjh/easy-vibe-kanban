import { useState, useEffect, useMemo } from 'react';
import {
  useWorkflowTemplate,
  useWorkflowTemplateMutations,
} from '@/shared/hooks/useWorkflowTemplates';
import {
  useWorkflowAttemptForWorkflow,
  useWorkflowAttemptMutations,
} from '@/shared/hooks/useWorkflowAttempts';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import {
  clearConditionBranchTargetForEdge,
  createDefaultWorkflowGraph,
  createWorkflowEdge,
  createWorkflowNode,
  getConditionBranchNameForEdge,
  getConditionBranchNamesForEdge,
  migrateWorkflowGraph,
  setConditionBranchTargetForEdge,
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
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { WorkflowCanvas } from './WorkflowCanvas';
import {
  WorkflowAgentStepEditDialog,
  type WorkflowAgentStepEditValue,
} from './WorkflowAgentStepEditDialog';
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
  Play as PlayIcon,
} from 'lucide-react';
import { ReactFlowProvider } from '@xyflow/react';
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
  const [editDialogNodeId, setEditDialogNodeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] =
    useState<AgentStepContextMenuState | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [graphParseError, setGraphParseError] = useState<string | null>(null);
  const [runStartError, setRunStartError] = useState<string | null>(null);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [validationTouched, setValidationTouched] = useState(false);

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

  const handleAddNode = (
    kind: WorkflowNodeKind,
    position?: WorkflowNodePosition
  ) => {
    if (!graph || readOnly) return;
    const newPosition = getNewWorkflowNodePosition({
      graph,
      selectedNodeId,
      requestedPosition: position,
    });
    const newNode = createWorkflowNode(kind, { position: newPosition });
    const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId);
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
    setSessionPanelNodeId(null);
    setEditDialogNodeId(isWorkflowAgentDraftNode(newNode) ? newNode.id : null);
  };

  const handleGraphChange = (newGraph: WorkflowGraph) => {
    setValidationTouched(false);
    setRunStartError(null);
    setGraph(newGraph);
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
    if (!graph || !editDialogNodeId || readOnly || isUpdating) {
      return;
    }

    const nextGraph = applyWorkflowNodeDataPatch(graph, editDialogNodeId, {
      display_name: displayName,
      ...createWorkflowAgentNodeDraftPatch({ prompt, executorConfig }),
    });
    setGraph(nextGraph);
    setRunStartError(null);
    try {
      await persistWorkflowGraph(nextGraph);
      setEditDialogNodeId(null);
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
    setContextMenu(null);
    setEditDialogNodeId(null);
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
    setSessionPanelNodeId(null);
    setEditDialogNodeId(duplicate.id);
    setContextMenu(null);
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
    if (sessionPanelNodeId === nodeId) setSessionPanelNodeId(null);
    if (editDialogNodeId === nodeId) setEditDialogNodeId(null);
    setContextMenu(null);
    try {
      await persistWorkflowGraph(nextGraph);
    } catch (err) {
      setRunStartError(getWorkflowRunErrorMessage(err));
    }
  };

  const handleEdgeChange = (
    edgeId: string,
    updates: Partial<Pick<WorkflowEdge, 'type'>>
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
  };

  const handleConditionBranchChange = (edgeId: string, branchName: string) => {
    if (!graph || readOnly) return;
    setValidationTouched(false);
    setGraph(setConditionBranchTargetForEdge(graph, edgeId, branchName));
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
  const editDialogNode = useMemo(
    () => graph?.nodes.find((node) => node.id === editDialogNodeId) ?? null,
    [editDialogNodeId, graph]
  );
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
              onClick={() => {
                setEditDialogNodeId(contextMenu.nodeId);
                setSessionPanelNodeId(null);
                setContextMenu(null);
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={readOnly}
              onClick={() => handleDuplicateAgentStep(contextMenu.nodeId)}
            >
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem disabled>Run From Here</DropdownMenuItem>
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

      <div className="flex flex-1 overflow-hidden">
        {/* Canvas & Bottom Panel */}
        <div className="relative flex flex-1 flex-col">
          <div className="relative flex-1">
            <ReactFlowProvider>
              <WorkflowCanvas
                graph={graph}
                validationIssues={validationIssues}
                readOnly={readOnly}
                onChange={handleGraphChange}
                onSelectionChange={(selection) => {
                  setSelectedNodeId(selection.nodeId);
                  setSelectedEdgeId(selection.edgeId);
                  setContextMenu(null);
                  setSessionPanelNodeId((currentPanelNodeId) =>
                    selection.edgeId || selection.nodeId !== currentPanelNodeId
                      ? null
                      : currentPanelNodeId
                  );
                }}
                onNodeDrop={handleAddNode}
                onNodeOpen={(nodeId) => void handleOpenAgentSession(nodeId)}
                onNodeContextMenu={(event) => {
                  const node = graph.nodes.find(
                    (candidate) => candidate.id === event.nodeId
                  );
                  setContextMenu(node?.type === 'agent' ? event : null);
                }}
              />
            </ReactFlowProvider>
          </div>
          <WorkflowValidationPanel graph={graph} />
        </div>

        {/* Inspector */}
        <div
          className={
            sessionPanelExecution
              ? 'relative z-10 w-[560px] shrink-0 border-l border-secondary bg-panel shadow-[-8px_0_18px_rgba(15,23,42,0.06)] xl:w-[640px]'
              : 'relative z-10 w-80 shrink-0 border-l border-secondary bg-panel shadow-[-8px_0_18px_rgba(15,23,42,0.06)]'
          }
        >
          {sessionPanelExecution ? (
            <div
              data-testid="workflow-node-conversation-panel"
              className="h-full overflow-hidden p-base"
            >
              <WorkflowNodeSessionPanel
                execution={sessionPanelExecution}
                workspaceId={workflowAttempt?.workspace_id ?? null}
                sessionHref={null}
                workspaceHref={null}
              />
            </div>
          ) : inspectorPanel.kind === 'edge' ? (
            <WorkflowEdgeInspector
              edge={inspectorPanel.edge}
              nodes={graph.nodes}
              conditionBranchName={selectedEdgeConditionBranchName}
              conditionBranchNames={selectedEdgeConditionBranchNames}
              readOnly={readOnly}
              onChange={handleEdgeChange}
              onConditionBranchChange={handleConditionBranchChange}
            />
          ) : (
            <WorkflowNodeInspector
              node={inspectorPanel.node}
              readOnly={readOnly}
              onChange={handleNodeChange}
            />
          )}
        </div>
      </div>
      <WorkflowAgentStepEditDialog
        key={editDialogNode?.id ?? 'agent-step-edit'}
        open={!!editDialogNode && editDialogNode.type === 'agent'}
        node={editDialogNode?.type === 'agent' ? editDialogNode : null}
        readOnly={readOnly}
        isSaving={isUpdating}
        error={runStartError}
        onOpenChange={(open) => {
          if (!open) setEditDialogNodeId(null);
        }}
        onSave={(value) => void handleAgentStepEditSave(value)}
      />
    </div>
  );
}
