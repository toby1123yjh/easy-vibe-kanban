import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkflowNodeKind } from '../model/workflowGraph';
import { getWorkflowNodeCatalogSections } from '../model/workflowNodeCatalog';
import {
  getWorkflowNodeKindLabel,
  getWorkflowNodeSummary,
  getWorkflowNodeVisual,
} from '../model/workflowPresentation';

const QUICK_ADD_SECTIONS = getWorkflowNodeCatalogSections();

export function WorkflowQuickAdd({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (type: WorkflowNodeKind) => void;
}) {
  const { t } = useTranslation('common');
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const groups = useMemo(
    () =>
      QUICK_ADD_SECTIONS.map((section) => ({
        id: section.id,
        label: t(section.labelKey, { defaultValue: section.label }),
        items: section.entries.map((entry) => ({
          type: entry.type,
          label: getWorkflowNodeKindLabel(entry.type, t),
          description: getWorkflowNodeSummary(entry.type, entry.defaultData, t),
          color: getWorkflowNodeVisual(entry.type).accentClass,
        })),
      })),
    [t]
  );

  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return groups;

    return groups
      .map((group) => {
        const items = group.items.filter((item) =>
          `${group.label} ${item.label} ${item.description}`
            .toLowerCase()
            .includes(normalizedQuery)
        );
        return { ...group, items };
      })
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={t('workflow.editor.addWorkflowStep', {
        defaultValue: 'Add workflow Node',
      })}
      className="workflow-popover-surface w-[320px] rounded-xl border p-3 transition-opacity"
      style={{
        position: 'fixed',
        left: '50%',
        top: 80,
        zIndex: 10000,
        transform: 'translateX(-50%)',
      }}
    >
      <input
        ref={inputRef}
        className="w-full rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-high placeholder:text-low/60 focus:border-brand/50 focus:outline-none focus:ring-1 focus:ring-brand/50"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        placeholder={t('workflow.editor.searchSteps', {
          defaultValue: 'Search Nodes...',
        })}
      />
      <div role="listbox" className="mt-3 max-h-72 space-y-3 overflow-auto">
        {filteredGroups.map((group) => (
          <div key={group.id} className="space-y-1">
            <div className="px-1 text-[10px] font-bold uppercase tracking-wider text-low/60">
              {group.label}
            </div>
            <div className="space-y-1">
              {group.items.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  role="option"
                  aria-selected={false}
                  className="group flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-white/[0.04] focus:bg-white/[0.04] focus:outline-none"
                  onClick={() => onSelect(item.type)}
                >
                  <span className="flex items-center gap-2 text-xs font-semibold text-high">
                    <span
                      className={`h-2 w-2 rounded-full shadow-sm ${item.color}`}
                    />
                    {item.label}
                  </span>
                  <span className="text-[10px] text-low/80 group-hover:text-low">
                    {item.description}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {filteredGroups.length === 0 ? (
          <div className="py-4 text-center text-xs text-low">
            {t('workflow.editor.noStepTypesFound', {
              defaultValue: 'No Node types found',
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
