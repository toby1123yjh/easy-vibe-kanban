import type { WorkflowGraph } from '../model/workflowGraph';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

export interface ValidationIssue {
  type: 'error' | 'warning';
  message: string;
}

export interface WorkflowValidationPanelProps {
  graph: WorkflowGraph | null;
}

export function validateWorkflowGraph(
  graph: WorkflowGraph | null
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!graph) return issues;

  if (graph.version !== 1) {
    issues.push({ type: 'error', message: 'Unsupported graph version' });
  }

  const nodes = graph.nodes;
  const edges = graph.edges;

  const startNodes = nodes.filter((n) => n.type === 'start');
  if (startNodes.length !== 1) {
    issues.push({
      type: 'error',
      message: `Expected exactly 1 Start node, found ${startNodes.length}`,
    });
  }

  const endNodes = nodes.filter((n) => n.type === 'end');
  if (endNodes.length === 0) {
    issues.push({
      type: 'error',
      message: 'Workflow must have at least one End node',
    });
  }

  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) {
      issues.push({
        type: 'error',
        message: `Duplicate node ID found: ${node.id}`,
      });
    }
    nodeIds.add(node.id);
  }

  for (const edge of edges) {
    if (edge.source === edge.target) {
      issues.push({
        type: 'error',
        message: `Self-edge found on node ${edge.source}`,
      });
    }
    if (!nodeIds.has(edge.source)) {
      issues.push({
        type: 'error',
        message: `Edge source node missing: ${edge.source}`,
      });
    }
    if (!nodeIds.has(edge.target)) {
      issues.push({
        type: 'error',
        message: `Edge target node missing: ${edge.target}`,
      });
    }
  }

  return issues;
}

export function WorkflowValidationPanel({
  graph,
}: WorkflowValidationPanelProps) {
  const issues = validateWorkflowGraph(graph);

  return (
    <div className="max-h-48 overflow-y-auto border-t border-secondary bg-panel p-4 text-sm">
      <h3 className="mb-2 font-semibold text-high">Validation</h3>
      {issues.length === 0 ? (
        <div className="flex items-center gap-2 text-success">
          <CheckCircle2 className="h-4 w-4" />
          <span>Graph is valid</span>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {issues.map((issue, i) => (
            <li
              key={i}
              className={`flex items-start gap-2 ${
                issue.type === 'error' ? 'text-error' : 'text-brand'
              }`}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
