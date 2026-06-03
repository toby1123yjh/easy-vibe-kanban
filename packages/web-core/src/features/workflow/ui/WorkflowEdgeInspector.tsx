import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, GitBranch, Trash2 } from 'lucide-react';
import {
  DEFAULT_SOURCE_HANDLE,
  DEFAULT_TARGET_HANDLE,
  type WorkflowEdge,
  type WorkflowEdgeKind,
  type WorkflowNode,
} from '../model/workflowGraph';
import { getWorkflowEdgeKindOptions } from '../model/workflowPresentation';

export interface WorkflowEdgeInspectorProps {
  edge: WorkflowEdge | null;
  nodes: WorkflowNode[];
  focusField?: 'source' | 'target' | null;
  readOnly?: boolean;
  onChange?: (edgeId: string, updates: Partial<WorkflowEdge>) => void;
  onDelete?: (edgeId: string) => void;
}

function getNodeLabel(nodes: WorkflowNode[], nodeId: string): string {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  return String(node?.data.display_name || nodeId);
}

export function WorkflowEdgeInspector({
  edge,
  nodes,
  focusField,
  readOnly,
  onChange,
  onDelete,
}: WorkflowEdgeInspectorProps) {
  const { t } = useTranslation('common');
  const sourceSelectRef = useRef<HTMLSelectElement>(null);
  const targetSelectRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (focusField === 'source') {
      sourceSelectRef.current?.focus();
    } else if (focusField === 'target') {
      targetSelectRef.current?.focus();
    }
  }, [edge?.id, focusField]);

  if (!edge) {
    return (
      <div className="flex h-full items-center justify-center p-base text-center text-low text-sm">
        {t('workflow.inspector.selectEdge')}
      </div>
    );
  }

  const edgeKindOptions = getWorkflowEdgeKindOptions(t);
  const selectedOption = edgeKindOptions.find(
    (option) => option.value === edge.type
  );
  const sourceLabel = getNodeLabel(nodes, edge.source);
  const targetLabel = getNodeLabel(nodes, edge.target);
  const sourceNodeOptions = nodes.filter((node) => node.type !== 'end');
  const targetNodeOptions = nodes.filter((node) => node.type !== 'start');

  const handleTypeChange = (value: WorkflowEdgeKind) => {
    if (readOnly || !onChange) return;
    onChange(edge.id, { type: value });
  };

  const handleSourceChange = (source: string) => {
    if (readOnly || !onChange) return;
    onChange(edge.id, {
      source,
      source_handle: edge.source_handle ?? DEFAULT_SOURCE_HANDLE,
    });
  };

  const handleTargetChange = (target: string) => {
    if (readOnly || !onChange) return;
    onChange(edge.id, {
      target,
      target_handle: edge.target_handle ?? DEFAULT_TARGET_HANDLE,
    });
  };

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4 text-sm">
      <div className="mb-2 flex items-center gap-2 border-b border-secondary pb-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-secondary/20">
          <GitBranch className="h-4 w-4 text-high" />
        </div>
        <span className="font-semibold text-high">
          {t('workflow.inspector.edgeProperties')}
        </span>
      </div>

      <button
        type="button"
        className="inline-flex items-center justify-center gap-2 rounded border border-error/30 bg-error/10 px-3 py-2 font-semibold text-error transition-colors hover:bg-error/15 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={readOnly || !onDelete}
        onClick={() => onDelete?.(edge.id)}
      >
        <Trash2 className="h-4 w-4" />
        {t('workflow.editor.deleteEdge')}
      </button>

      <div className="rounded border border-secondary bg-primary/40 p-3">
        <div className="truncate text-sm font-semibold text-high">
          {sourceLabel}
        </div>
        <div className="flex h-8 items-center">
          <ArrowDown className="h-4 w-4 text-low" />
        </div>
        <div className="truncate text-sm font-semibold text-high">
          {targetLabel}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded border border-secondary bg-primary/40 p-3">
        <div className="text-xs font-semibold uppercase tracking-normal text-low">
          {t('workflow.editor.reconnect')}
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-semibold text-high">
            {t('workflow.inspector.source')}
          </label>
          <select
            ref={sourceSelectRef}
            className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
            value={edge.source}
            onChange={(event) => handleSourceChange(event.target.value)}
            disabled={readOnly}
          >
            {sourceNodeOptions.map((node) => (
              <option
                key={node.id}
                value={node.id}
                disabled={node.id === edge.target}
              >
                {getNodeLabel(nodes, node.id)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="font-semibold text-high">
            {t('workflow.inspector.target')}
          </label>
          <select
            ref={targetSelectRef}
            className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
            value={edge.target}
            onChange={(event) => handleTargetChange(event.target.value)}
            disabled={readOnly}
          >
            {targetNodeOptions.map((node) => (
              <option
                key={node.id}
                value={node.id}
                disabled={node.id === edge.source}
              >
                {getNodeLabel(nodes, node.id)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-semibold text-high">
          {t('workflow.inspector.routeType')}
        </label>
        <select
          className="w-full rounded border border-secondary bg-primary px-2 py-1 text-normal disabled:opacity-50"
          value={edge.type}
          onChange={(event) =>
            handleTypeChange(event.target.value as WorkflowEdgeKind)
          }
          disabled={readOnly}
        >
          {edgeKindOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {selectedOption ? (
          <p className="text-xs text-low">{selectedOption.description}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label className="font-semibold text-high">
          {t('workflow.inspector.edgeId')}
        </label>
        <div className="truncate rounded border border-secondary bg-primary px-2 py-1 text-xs text-low">
          {edge.id}
        </div>
      </div>
    </div>
  );
}
