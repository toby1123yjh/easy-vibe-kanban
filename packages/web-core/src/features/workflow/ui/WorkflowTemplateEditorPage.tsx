import { useState, useEffect, useMemo } from 'react';
import {
  useWorkflowTemplate,
  useWorkflowTemplateMutations,
} from '@/shared/hooks/useWorkflowTemplates';
import {
  clearConditionBranchTargetForEdge,
  createDefaultWorkflowGraph,
  createWorkflowNode,
  getConditionBranchNameForEdge,
  getConditionBranchNamesForEdge,
  setConditionBranchTargetForEdge,
  type WorkflowGraph,
  type WorkflowEdge,
  type WorkflowNodeKind,
  type WorkflowNodePosition,
  WORKFLOW_NODE_DRAG_DATA_TYPE,
} from '../model/workflowGraph';
import { getWorkflowNodeCatalogSections } from '../model/workflowNodeCatalog';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { WorkflowCanvas } from './WorkflowCanvas';
import { WorkflowEdgeInspector } from './WorkflowEdgeInspector';
import { WorkflowNodeInspector } from './WorkflowNodeInspector';
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
  const { updateTemplate, createTemplate, isUpdating, isCreating } =
    useWorkflowTemplateMutations();
  const navigation = useAppNavigation();

  const [graph, setGraph] = useState<WorkflowGraph | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [graphParseError, setGraphParseError] = useState<string | null>(null);
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
          setGraph(parsed);
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
  };

  const handleGraphChange = (newGraph: WorkflowGraph) => {
    setValidationTouched(false);
    setGraph(newGraph);
  };

  const handleNodeChange = (
    nodeId: string,
    dataUpdates: Partial<WorkflowGraph['nodes'][number]['data']>
  ) => {
    if (!graph || readOnly) return;
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

  return (
    <div className="flex h-full flex-col bg-primary">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-secondary bg-panel p-base">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={handleBack}
            className="p-2"
            aria-label="Back to workflows"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex flex-col">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={readOnly}
              className="bg-transparent text-lg font-semibold text-high outline-none disabled:opacity-50"
              placeholder="Workflow Name"
            />
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={readOnly}
              className="mt-1 min-w-[280px] bg-transparent text-xs text-low outline-none disabled:opacity-50"
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
            disabled
            className="flex items-center gap-2"
            aria-label="Run workflow test"
          >
            <PlayIcon className="h-4 w-4" />
            Run test
          </Button>
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
      ) : validationTouched && validationIssues.length > 0 ? (
        <div className="border-b border-brand/30 bg-brand/10 px-base py-half text-xs text-brand">
          Validation found {validationIssues.length} issue
          {validationIssues.length === 1 ? '' : 's'}.
        </div>
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        {/* Node Library */}
        <div className="w-64 shrink-0 overflow-y-auto border-r border-secondary bg-panel p-4">
          <h3 className="mb-4 font-semibold text-high">Nodes</h3>
          <div className="flex flex-col gap-4">
            {nodeCatalogSections.map((section) => (
              <div key={section.label} className="flex flex-col gap-2">
                <div className="px-1 text-[11px] font-semibold uppercase tracking-normal text-low">
                  {section.label}
                </div>
                {section.entries.map((entry) => {
                  const Icon = getWorkflowNodeIcon(entry.type);
                  return (
                    <button
                      key={entry.type}
                      className="group flex cursor-grab items-center gap-3 rounded border border-secondary bg-panel p-3 text-left transition-colors hover:border-brand active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
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
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-secondary/20">
                        <Icon className="h-4 w-4 text-high" />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-high">
                          {entry.label}
                        </div>
                        <div className="text-xs text-low">
                          {entry.description}
                        </div>
                      </div>
                      <Plus className="h-4 w-4 shrink-0 text-low opacity-0 transition-opacity group-hover:opacity-100" />
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
                readOnly={readOnly}
                onChange={handleGraphChange}
                onSelectionChange={(selection) => {
                  setSelectedNodeId(selection.nodeId);
                  setSelectedEdgeId(selection.edgeId);
                }}
                onNodeDrop={handleAddNode}
              />
            </ReactFlowProvider>
          </div>
          <WorkflowValidationPanel graph={graph} />
        </div>

        {/* Inspector */}
        <div className="w-80 shrink-0 border-l border-secondary bg-panel">
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
    </div>
  );
}
