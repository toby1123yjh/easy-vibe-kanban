import { useState, useEffect, useMemo } from 'react';
import {
  useWorkflowTemplate,
  useWorkflowTemplateMutations,
} from '@/shared/hooks/useWorkflowTemplates';
import { useWorkflowAttemptForWorkflow } from '@/shared/hooks/useWorkflowAttempts';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import {
  clearConditionBranchTargetForEdge,
  createDefaultWorkflowGraph,
  createWorkflowNode,
  getConditionBranchNameForEdge,
  getConditionBranchNamesForEdge,
  migrateWorkflowGraph,
  setConditionBranchTargetForEdge,
  type WorkflowGraph,
  type WorkflowEdge,
  type WorkflowNodeKind,
  type WorkflowNodePosition,
  WORKFLOW_NODE_DRAG_DATA_TYPE,
} from '../model/workflowGraph';
import { queueWorkflowRunNodeFocus } from '../model/workflowRunNodeFocus';
import { getWorkflowNodeCatalogSections } from '../model/workflowNodeCatalog';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { WorkflowCanvas } from './WorkflowCanvas';
import { WorkflowEdgeInspector } from './WorkflowEdgeInspector';
import { WorkflowNodeInspector } from './WorkflowNodeInspector';
import {
  RunWorkflowDialog,
  type WorkflowWorkspaceOption,
} from './RunWorkflowDialog';
import {
  WorkflowValidationPanel,
  validateWorkflowGraph,
} from './WorkflowValidationPanel';
import { Button } from '@vibe/ui/components/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/Dialog';
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
import { getWorkflowNodeIcon } from './workflowNodeIcons';

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
  const navigation = useAppNavigation();
  const { getIssue, getWorkspacesForIssue } = useProjectContext();
  const { activeWorkspaces, archivedWorkspaces } = useWorkspaceContext();

  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [openNodeDialogId, setOpenNodeDialogId] = useState<string | null>(null);
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

  const handleSave = async () => {
    if (!graph || readOnly) return;
    await updateTemplate({
      workflowId,
      payload: {
        name,
        description,
        graph_json: JSON.stringify(graph),
      },
    });
  };

  const issue = workflowAttempt ? getIssue(workflowAttempt.issue_id) : null;

  const localWorkspacesById = useMemo(() => {
    const map = new Map<string, (typeof activeWorkspaces)[number]>();

    for (const workspace of activeWorkspaces) {
      map.set(workspace.id, workspace);
    }

    for (const workspace of archivedWorkspaces) {
      map.set(workspace.id, workspace);
    }

    return map;
  }, [activeWorkspaces, archivedWorkspaces]);

  const workflowWorkspaces = useMemo<WorkflowWorkspaceOption[]>(() => {
    if (!workflowAttempt) return [];

    return getWorkspacesForIssue(workflowAttempt.issue_id)
      .filter((workspace) => workspace.local_workspace_id)
      .map((workspace) => {
        const localWorkspace = localWorkspacesById.get(
          workspace.local_workspace_id as string
        );
        return {
          id: workspace.local_workspace_id as string,
          label:
            workspace.name ||
            localWorkspace?.name ||
            `Workspace ${workspace.local_workspace_id}`,
          branch: localWorkspace?.branch ?? null,
        };
      });
  }, [getWorkspacesForIssue, localWorkspacesById, workflowAttempt]);

  const handleRunAttempt = async () => {
    if (!graph || !workflowAttempt || readOnly) return;

    const runValidationIssues = validateWorkflowGraph(graph);
    if (runValidationIssues.length > 0 || graphParseError) {
      setValidationTouched(true);
      return;
    }

    setIsStartingRun(true);
    setRunStartError(null);
    try {
      await updateTemplate({
        workflowId,
        payload: {
          name,
          description,
          graph_json: JSON.stringify(graph),
        },
      });
      await RunWorkflowDialog.show({
        projectId,
        issueId: workflowAttempt.issue_id,
        issueTitle: issue?.title ?? name,
        issueDescription: issue?.description ?? description,
        attemptId: workflowAttempt.id,
        attemptName: workflowAttempt.name || name,
        workspaces: workflowWorkspaces,
      });
    } catch (err) {
      setRunStartError(
        err instanceof Error ? err.message : 'Failed to start workflow attempt.'
      );
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
    navigation.goToProjectWorkflows(projectId);
  };

  const handleAddNode = (
    kind: WorkflowNodeKind,
    position?: WorkflowNodePosition
  ) => {
    if (!graph || readOnly) return;
    const newNode = createWorkflowNode(kind, { position });
    setGraph({
      ...graph,
      nodes: [...graph.nodes, newNode],
    });
    setSelectedNodeId(newNode.id);
    setSelectedEdgeId(null);
    setOpenNodeDialogId(newNode.id);
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
    setGraph({
      ...graph,
      nodes: graph.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, ...dataUpdates } }
          : node
      ),
    });
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

  const dialogNode = useMemo(
    () => graph?.nodes.find((node) => node.id === openNodeDialogId) ?? null,
    [graph, openNodeDialogId]
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
  const nodeCatalogSections = getWorkflowNodeCatalogSections();
  const canRunWorkflowAttempt =
    !!workflowAttempt &&
    !isWorkflowAttemptLoading &&
    !isStartingRun &&
    !isUpdating &&
    isValid &&
    !readOnly;

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
            onClick={() => setValidationTouched(true)}
            className="flex items-center gap-2"
          >
            <CheckCircle2 className="h-4 w-4" />
            Validate
          </Button>
          <Button
            variant="outline"
            disabled={!canRunWorkflowAttempt}
            onClick={() => void handleRunAttempt()}
            className="flex items-center gap-2"
            aria-label="Run workflow attempt"
            title={
              workflowAttempt
                ? undefined
                : 'This workflow is not linked to a task attempt.'
            }
          >
            {isStartingRun || isWorkflowAttemptLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PlayIcon className="h-4 w-4" />
            )}
            Start run
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

      <div className="flex flex-1 overflow-hidden">
        {/* Node Library */}
        <div className="relative z-10 w-64 shrink-0 overflow-y-auto border-r border-secondary bg-panel p-4 shadow-[8px_0_18px_rgba(15,23,42,0.06)]">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-low">
            Steps
          </h3>
          <div className="flex flex-col gap-4">
            {nodeCatalogSections.map((section) => (
              <div key={section.label} className="flex flex-col gap-2">
                <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-low/60">
                  {section.label}
                </div>
                {section.entries.map((entry) => {
                  const Icon = getWorkflowNodeIcon(entry.type);
                  return (
                    <button
                      key={entry.type}
                      className="group flex cursor-grab items-center gap-3 rounded-lg border border-secondary bg-panel p-2.5 text-left transition-all hover:bg-secondary/5 hover:border-brand hover:shadow-sm active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => handleAddNode(entry.type)}
                      draggable={!readOnly}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(
                          WORKFLOW_NODE_DRAG_DATA_TYPE,
                          entry.type
                        );
                        event.dataTransfer.effectAllowed = 'copy';
                      }}
                      disabled={readOnly}
                      title={entry.description}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-secondary/40 bg-secondary/20 shadow-sm">
                        <Icon className="h-4 w-4 text-high" />
                      </div>
                      <div className="flex-1">
                        <div className="text-[13px] font-medium leading-tight text-high">
                          {entry.label}
                        </div>
                        <div className="mt-0.5 text-[11px] text-low">
                          {entry.description}
                        </div>
                      </div>
                      <Plus className="h-4 w-4 shrink-0 text-brand opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

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
                }}
                onNodeDrop={handleAddNode}
                onNodeOpen={(nodeId) => {
                  setSelectedNodeId(nodeId);
                  setSelectedEdgeId(null);
                  if (workflowAttempt?.latest_run_id) {
                    queueWorkflowRunNodeFocus(workflowAttempt.latest_run_id, {
                      nodeId,
                      panel: 'conversation',
                    });
                    navigation.goToProjectWorkflowRun(
                      projectId,
                      workflowAttempt.latest_run_id
                    );
                    return;
                  }
                  setOpenNodeDialogId(nodeId);
                }}
              />
            </ReactFlowProvider>
          </div>
          <WorkflowValidationPanel graph={graph} />
        </div>

        {/* Inspector */}
        <div className="relative z-10 w-80 shrink-0 border-l border-secondary bg-panel shadow-[-8px_0_18px_rgba(15,23,42,0.06)]">
          {selectedEdge ? (
            <WorkflowEdgeInspector
              edge={selectedEdge}
              nodes={graph.nodes}
              conditionBranchName={selectedEdgeConditionBranchName}
              conditionBranchNames={selectedEdgeConditionBranchNames}
              readOnly={readOnly}
              onChange={handleEdgeChange}
              onConditionBranchChange={handleConditionBranchChange}
            />
          ) : (
            <WorkflowNodeInspector
              node={selectedNode}
              readOnly={readOnly}
              onChange={handleNodeChange}
            />
          )}
        </div>
      </div>

      <Dialog
        open={Boolean(dialogNode)}
        onOpenChange={(open) => {
          if (!open) {
            setOpenNodeDialogId(null);
          }
        }}
      >
        <DialogContent
          data-testid="workflow-node-dialog"
          className="flex max-h-[82vh] max-w-[520px] flex-col p-0"
        >
          <div className="border-b border-secondary px-5 py-4">
            <DialogHeader className="space-y-half">
              <DialogTitle>
                {dialogNode
                  ? `${dialogNode.data.display_name || 'Step'} configuration`
                  : 'Step configuration'}
              </DialogTitle>
              <DialogDescription>
                {dialogNode
                  ? `Edit ${dialogNode.type.replace('_', ' ')} step settings.`
                  : 'Edit step settings.'}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <WorkflowNodeInspector
              node={dialogNode}
              readOnly={readOnly}
              onChange={handleNodeChange}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
