import { CaretDownIcon, ListMagnifyingGlassIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { ToolStatusDot, type ToolStatusLike } from './ToolStatusDot';

export interface AggregatedEntry {
  summary: string;
  status?: ToolStatusLike;
  expansionKey: string;
  content?: string;
  command?: string;
}

interface ChatAggregatedToolEntriesProps {
  entries: AggregatedEntry[];
  expanded: boolean;
  isHovered: boolean;
  onToggle: () => void;
  onHoverChange: (hovered: boolean) => void;
  summary?: string;
  detail?: string;
  label?: string;
  unit?: string;
  icon?: React.ElementType;
  className?: string;
  onViewContent?: (index: number) => void;
  forceCollapsible?: boolean;
}

const STATUS_PRIORITY: Record<string, number> = {
  failed: 6,
  denied: 5,
  timed_out: 4,
  pending_approval: 3,
  created: 2,
  success: 1,
};

function getWorstStatus(entries: AggregatedEntry[]) {
  return entries.reduce<ToolStatusLike | undefined>((worst, entry) => {
    if (!entry.status) return worst;
    if (!worst) return entry.status;

    const worstPriority = STATUS_PRIORITY[worst.status] || 0;
    const currentPriority = STATUS_PRIORITY[entry.status.status] || 0;

    return currentPriority > worstPriority ? entry.status : worst;
  }, undefined);
}

function getFallbackSummary({
  entries,
  label,
  unit,
  fallbackSummary,
}: {
  entries: AggregatedEntry[];
  label?: string;
  unit?: string;
  fallbackSummary: string;
}) {
  if (!label || !unit) return fallbackSummary;
  return `${label} ${entries.length} ${unit}`;
}

export function ChatAggregatedToolEntries({
  entries,
  expanded,
  isHovered,
  onToggle,
  onHoverChange,
  summary,
  detail,
  label,
  unit,
  icon: Icon = ListMagnifyingGlassIcon,
  className,
  onViewContent,
  forceCollapsible = false,
}: ChatAggregatedToolEntriesProps) {
  const { t } = useTranslation('tasks');

  if (entries.length === 0) return null;

  const aggregateStatus = getWorstStatus(entries);
  const headerSummary =
    summary ??
    getFallbackSummary({
      entries,
      label,
      unit,
      fallbackSummary: t('conversation.aggregated.operationCount', {
        count: entries.length,
      }),
    });

  if (entries.length === 1 && !forceCollapsible) {
    const entry = entries[0];
    return (
      <button
        type="button"
        className={cn(
          'flex min-w-0 items-center gap-base text-left text-sm text-low',
          onViewContent && 'cursor-pointer hover:text-normal',
          className
        )}
        onClick={onViewContent ? () => onViewContent(0) : undefined}
        disabled={!onViewContent}
      >
        <span className="relative shrink-0 pt-0.5">
          <Icon className="size-icon-base" />
          {entry.status && (
            <ToolStatusDot
              status={entry.status}
              className="absolute -bottom-0.5 -left-0.5"
            />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">{headerSummary}</span>
        {detail && (
          <span className="hidden shrink-0 text-xs text-low sm:inline">
            {detail}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <button
        type="button"
        className="group flex min-w-0 items-center gap-base rounded-sm px-1 py-0.5 text-left text-sm text-low transition-colors hover:bg-muted/30 hover:text-normal"
        onClick={onToggle}
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        aria-expanded={expanded}
        data-scroll-anchor-target=""
      >
        <span className="relative shrink-0 pt-0.5">
          {isHovered ? (
            <CaretDownIcon
              className={cn(
                'size-icon-base transition-transform duration-150',
                !expanded && '-rotate-90'
              )}
            />
          ) : (
            <Icon className="size-icon-base" />
          )}
          {aggregateStatus && (
            <ToolStatusDot
              status={aggregateStatus}
              className="absolute -bottom-0.5 -left-0.5"
            />
          )}
        </span>

        <span className="min-w-0 flex-1 truncate">{headerSummary}</span>
        {detail && (
          <span className="hidden shrink-0 text-xs text-low sm:inline">
            {detail}
          </span>
        )}
      </button>

      {expanded && (
        <div className="ml-6 flex flex-col gap-0.5 pt-1">
          {entries.map((entry, index) => (
            <button
              key={entry.expansionKey}
              type="button"
              className={cn(
                'flex min-w-0 items-center gap-base rounded-sm px-base py-0.5 text-left text-sm text-low',
                onViewContent &&
                  'cursor-pointer hover:bg-muted/30 hover:text-normal'
              )}
              onClick={onViewContent ? () => onViewContent(index) : undefined}
              disabled={!onViewContent}
            >
              <span className="relative shrink-0 pt-0.5">
                <Icon className="size-icon-base" />
                {entry.status && (
                  <ToolStatusDot
                    status={entry.status}
                    className="absolute -bottom-0.5 -left-0.5"
                  />
                )}
              </span>
              <span className="truncate">{entry.summary}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
