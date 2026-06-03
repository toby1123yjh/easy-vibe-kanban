import type { WorkflowTemplateResponse } from 'shared/types';
import type { WorkflowGraph, WorkflowNodeKind } from './workflowGraph';

const HIDDEN_SYSTEM_TEMPLATE_NODE_KINDS = new Set<WorkflowNodeKind>(['arena']);

export function shouldShowWorkflowTemplate(
  template: Pick<WorkflowTemplateResponse, 'source' | 'graph_json'>
): boolean {
  if (template.source !== 'system') {
    return true;
  }

  return !templateContainsHiddenNodeKind(template.graph_json);
}

function templateContainsHiddenNodeKind(graphJson: string): boolean {
  try {
    const graph = JSON.parse(graphJson) as Partial<WorkflowGraph>;
    return (
      Array.isArray(graph.nodes) &&
      graph.nodes.some((node) =>
        HIDDEN_SYSTEM_TEMPLATE_NODE_KINDS.has(node.type)
      )
    );
  } catch {
    return false;
  }
}
