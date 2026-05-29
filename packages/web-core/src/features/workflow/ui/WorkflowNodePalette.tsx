import { useMemo, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkflowNodeKind } from '../model/workflowGraph';
import { WORKFLOW_NODE_DRAG_DATA_TYPE } from '../model/workflowGraph';
import { getWorkflowNodeCatalogSections } from '../model/workflowNodeCatalog';
import {
  getWorkflowNodeKindLabel,
  getWorkflowNodeSummary,
  getWorkflowNodeVisual,
} from '../model/workflowPresentation';
import { cn } from '@/shared/lib/utils';

const PALETTE_SECTIONS = getWorkflowNodeCatalogSections();

export interface WorkflowNodePaletteProps {
  readOnly?: boolean;
  onSelect: (type: WorkflowNodeKind) => void;
}

export function WorkflowNodePalette({
  readOnly = false,
  onSelect,
}: WorkflowNodePaletteProps) {
  const { t } = useTranslation('common');
  const [query, setQuery] = useState('');

  const groups = useMemo(
    () =>
      PALETTE_SECTIONS.map((section) => ({
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
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${group.label} ${item.label} ${item.description}`
            .toLowerCase()
            .includes(normalizedQuery)
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  const handleDragStart = (
    event: DragEvent<HTMLButtonElement>,
    type: WorkflowNodeKind
  ) => {
    if (readOnly) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(WORKFLOW_NODE_DRAG_DATA_TYPE, type);
  };

  return (
    <aside className="workflow-node-palette-surface flex h-full min-h-0 w-[260px] shrink-0 flex-col border-r border-[var(--workflow-panel-border)] bg-[var(--workflow-panel-bg)] shadow-[var(--workflow-palette-shadow)]">
      <div className="shrink-0 border-b border-white/8 px-3 py-3">
        <div className="text-xs font-semibold text-high">
          {t('workflow.editor.nodePalette', {
            defaultValue: 'Node library',
          })}
        </div>
        {readOnly ? (
          <div className="mt-1 text-[10px] leading-4 text-low">
            {t('workflow.editor.nodePaletteReadOnly', {
              defaultValue: 'Copy this template to add or drag steps.',
            })}
          </div>
        ) : null}
        <input
          className="mt-3 h-8 w-full rounded-md border border-white/10 bg-white/[0.035] px-2 text-xs text-high outline-none placeholder:text-low/60 transition-colors focus:border-brand/50 focus:ring-1 focus:ring-brand/35"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('workflow.editor.searchSteps', {
            defaultValue: 'Search steps...',
          })}
        />
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-3">
        {filteredGroups.map((group) => (
          <section key={group.id} className="space-y-1.5">
            <div className="px-2 text-[10px] font-bold uppercase text-low/65">
              {group.label}
            </div>
            <div className="space-y-1.5">
              {group.items.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  draggable={!readOnly}
                  disabled={readOnly}
                  onDragStart={(event) => handleDragStart(event, item.type)}
                  onClick={() => onSelect(item.type)}
                  className={cn(
                    'group w-full rounded-lg border border-white/8 bg-white/[0.035] px-3 py-2 text-left shadow-[var(--workflow-palette-item-shadow)] transition-[transform,border-color,background-color,box-shadow] duration-150',
                    'hover:-translate-y-0.5 hover:border-brand/35 hover:bg-white/[0.06] hover:shadow-[var(--workflow-palette-item-shadow-hover)]',
                    'focus:outline-none focus:ring-1 focus:ring-brand/45',
                    readOnly &&
                      'cursor-not-allowed opacity-45 hover:translate-y-0 hover:border-white/8 hover:bg-white/[0.035] hover:shadow-[var(--workflow-palette-item-shadow)]'
                  )}
                >
                  <span className="flex items-center gap-2 text-xs font-semibold text-high">
                    <span
                      className={cn(
                        'h-2.5 w-2.5 rounded-full shadow-sm',
                        item.color
                      )}
                    />
                    {item.label}
                  </span>
                  <span className="mt-1 block text-[10px] leading-4 text-low/82">
                    {item.description}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {filteredGroups.length === 0 ? (
          <div className="py-8 text-center text-xs text-low">
            {t('workflow.editor.noStepTypesFound', {
              defaultValue: 'No step types found',
            })}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
