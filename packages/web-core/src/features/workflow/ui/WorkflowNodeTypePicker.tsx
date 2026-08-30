import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { Button } from '@vibe/ui/components/Button';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from '@vibe/ui/components/Popover';
import { WORKFLOW_NODE_CATALOG } from '../model/workflowNodeCatalog';
import type { WorkflowNodeKind } from '../model/workflowGraph';
import { getWorkflowNodeIcon } from './workflowNodeIcons';
import { getWorkflowNodeKindLabel } from '../model/workflowPresentation';

const AUTHORABLE_TYPES = WORKFLOW_NODE_CATALOG.filter(
  (entry) => entry.type !== 'start' && entry.type !== 'end'
);

export interface WorkflowNodeTypePickerProps {
  disabled?: boolean;
  anchorPoint?: { x: number; y: number } | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSelect: (type: Exclude<WorkflowNodeKind, 'start' | 'end'>) => void;
}

export function WorkflowNodeTypePicker({
  disabled,
  anchorPoint,
  open: controlledOpen,
  onOpenChange,
  onSelect,
}: WorkflowNodeTypePickerProps) {
  const { t } = useTranslation('common');
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {anchorPoint ? (
        <PopoverAnchor asChild>
          <span
            aria-hidden="true"
            className="pointer-events-none fixed z-[var(--vk-z-popover)] size-px"
            style={{ left: anchorPoint.x, top: anchorPoint.y }}
          />
        </PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>
          <Button
            type="button"
            disabled={disabled}
            className="h-9 gap-2 shadow-sm"
            aria-label={t('workflow.nodePicker.addNode', {
              defaultValue: 'Add Node',
            })}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t('workflow.nodePicker.addNode', { defaultValue: 'Add Node' })}
          </Button>
        </PopoverTrigger>
      )}
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={8}
        className="w-[320px] p-2"
        aria-label={t('workflow.nodePicker.chooseNodeType', {
          defaultValue: 'Choose Node type',
        })}
      >
        <div className="flex flex-col gap-1">
          {AUTHORABLE_TYPES.map((entry) => {
            const Icon = getWorkflowNodeIcon(entry.type);
            return (
              <button
                key={entry.type}
                type="button"
                className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-[var(--vk-radius-sm)] px-3 py-2 text-left transition-colors duration-150 hover:bg-[var(--vk-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vk-focus-ring)]"
                onClick={() => {
                  onSelect(
                    entry.type as Exclude<WorkflowNodeKind, 'start' | 'end'>
                  );
                  setOpen(false);
                }}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-[var(--vk-radius-sm)] border border-[var(--vk-border-subtle)] bg-[var(--vk-surface-muted)]">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-high">
                    {getWorkflowNodeKindLabel(entry.type, t)}
                  </span>
                  <span className="block truncate text-xs text-low">
                    {t(`workflow.nodePicker.descriptions.${entry.type}`, {
                      defaultValue: entry.description,
                    })}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
