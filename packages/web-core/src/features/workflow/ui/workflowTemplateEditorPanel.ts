import type {
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
  WorkflowNodeData,
} from '../model/workflowGraph';

export type WorkflowTemplateInspectorPanel =
  | { kind: 'edge'; edge: WorkflowEdge }
  | { kind: 'agentDraft'; node: WorkflowNode }
  | { kind: 'node'; node: WorkflowNode | null };

export function getNextAgentDraftPanelNodeIdForSelection({
  currentPanelNodeId,
  selectedNodeId,
  selectedEdgeId,
}: {
  currentPanelNodeId: string | null;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
}): string | null {
  if (selectedEdgeId || selectedNodeId !== currentPanelNodeId) {
    return null;
  }

  return currentPanelNodeId;
}

export function shouldKeepRouterConfigPanelForSelection({
  pendingRouterPromptNodeId,
  selectedNodeId,
  selectedEdgeId,
}: {
  pendingRouterPromptNodeId: string | null;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
}): boolean {
  return (
    !!pendingRouterPromptNodeId &&
    selectedNodeId === pendingRouterPromptNodeId &&
    !selectedEdgeId
  );
}

export function getWorkflowTemplateInspectorPanel({
  selectedEdge,
  selectedNode,
  requestedAgentDraftNode,
}: {
  selectedEdge: WorkflowEdge | null;
  selectedNode: WorkflowNode | null;
  requestedAgentDraftNode: WorkflowNode | null;
}): WorkflowTemplateInspectorPanel {
  if (selectedEdge) {
    return { kind: 'edge', edge: selectedEdge };
  }

  if (
    selectedNode &&
    requestedAgentDraftNode &&
    selectedNode.id === requestedAgentDraftNode.id &&
    requestedAgentDraftNode.type === 'agent'
  ) {
    return { kind: 'agentDraft', node: requestedAgentDraftNode };
  }

  return { kind: 'node', node: selectedNode };
}

export function applyWorkflowNodeDataPatch(
  graph: WorkflowGraph,
  nodeId: string,
  dataUpdates: Partial<WorkflowNodeData>
): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === nodeId
        ? { ...node, data: { ...node.data, ...dataUpdates } }
        : node
    ),
  };
}
