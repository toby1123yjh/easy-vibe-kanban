import { useTranslation } from 'react-i18next';
import { ArrowRight, ExternalLink, GitBranch, Trash2 } from 'lucide-react';
import type { WorkflowEdge, WorkflowNode } from '../model/workflowGraph';
import { getWorkflowEdgeKindOptions } from '../model/workflowPresentation';

export interface WorkflowEdgeInspectorProps {
  edge: WorkflowEdge | null;
  nodes: WorkflowNode[];
  readOnly?: boolean;
  onDelete?: (edgeId: string) => void;
  onOpenSourceNode?: (nodeId: string) => void;
}

function getNodeLabel(nodes: WorkflowNode[], nodeId: string): string {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  return String(node?.data.display_name || nodeId);
}

export function WorkflowEdgeInspector({
  edge,
  nodes,
  readOnly,
  onDelete,
  onOpenSourceNode,
}: WorkflowEdgeInspectorProps) {
  const { t } = useTranslation('common');

  if (!edge) {
    return (
      <div className="flex h-full items-center justify-center p-base text-center text-sm text-low">
        {t('workflow.inspector.selectEdge')}
      </div>
    );
  }

  const route = getWorkflowEdgeKindOptions(t).find(
    (option) => option.value === edge.type
  );
  const sourceLabel = getNodeLabel(nodes, edge.source);
  const targetLabel = getNodeLabel(nodes, edge.target);

  return (
    <div className="flex min-h-full flex-col gap-4 p-4 text-sm">
      <section className="rounded-md border border-secondary bg-primary/40 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-low">
          <GitBranch className="size-3.5" aria-hidden="true" />
          {t('workflow.inspector.connectionSummary', {
            defaultValue: 'Connection',
          })}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-semibold text-high">
            {sourceLabel}
          </span>
          <ArrowRight className="size-4 shrink-0 text-low" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-right font-semibold text-high">
            {targetLabel}
          </span>
        </div>
      </section>

      <section className="rounded-md border border-secondary bg-primary/40 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-low">
          {t('workflow.inspector.routeSemantics', {
            defaultValue: 'Route semantics',
          })}
        </div>
        <div className="mt-2 font-semibold text-high">
          {route?.label ?? edge.type}
        </div>
        {route?.description ? (
          <p className="mt-1 text-xs leading-relaxed text-low">
            {route.description}
          </p>
        ) : null}
      </section>

      {edge.type === 'condition_branch' && onOpenSourceNode ? (
        <button
          type="button"
          className="inline-flex items-center justify-center gap-2 rounded-md border border-secondary bg-primary px-3 py-2 font-semibold text-high transition-colors hover:border-brand hover:text-brand"
          onClick={() => onOpenSourceNode(edge.source)}
        >
          <ExternalLink className="size-4" aria-hidden="true" />
          {t('workflow.inspector.openSourceNode', {
            defaultValue: 'Open source Node',
          })}
        </button>
      ) : null}

      <section className="mt-auto border-t border-secondary pt-4">
        <button
          type="button"
          className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-error/30 bg-error/10 px-3 py-2 font-semibold text-error transition-colors hover:bg-error/15 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={readOnly || !onDelete}
          onClick={() => onDelete?.(edge.id)}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          {t('workflow.editor.deleteEdge')}
        </button>
      </section>
    </div>
  );
}
