import { CaretDownIcon, ListMagnifyingGlassIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { ActivityText } from './ActivityText';
import { ChatElapsedTime } from './ChatElapsedTime';
import { ToolStatusDot, type ToolStatusLike } from './ToolStatusDot';

export interface AggregatedEntry {
  summary: string;
  status?: ToolStatusLike;
  expansionKey: string;
  content?: string;
  command?: string;
  startedAt?: string | null;
  endedAt?: string | null;
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
  startedAt?: string | null;
  endedAt?: string | null;
}

const STATUS_PRIORITY: Record<string, number> = {
  failed: 6,
  denied: 5,
  timed_out: 4,
  pending_approval: 3,
  created: 2,
  success: 1,
};

const OUTPUT_PREVIEW_LIMIT = 1600;

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

function isActiveStatus(status?: ToolStatusLike) {
  return status?.status === 'created' || status?.status === 'pending_approval';
}

function getOutputPreview(content?: string) {
  const trimmed = content?.trim();
  if (!trimmed) return null;

  if (trimmed.length <= OUTPUT_PREVIEW_LIMIT) {
    return trimmed;
  }

  return `${trimmed.slice(0, OUTPUT_PREVIEW_LIMIT).trimEnd()}\n...`;
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
  startedAt,
  endedAt,
}: ChatAggregatedToolEntriesProps) {
  const { t } = useTranslation('tasks');

  if (entries.length === 0) return null;

  const aggregateStatus = getWorstStatus(entries);
  const isRunning = entries.some((entry) => isActiveStatus(entry.status));
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
        <ActivityText active={isRunning} className="min-w-0 flex-1 truncate">
          {headerSummary}
        </ActivityText>
        {detail && (
          <span className="hidden shrink-0 text-xs text-low sm:inline">
            {detail}
          </span>
        )}
        <ChatElapsedTime
          startedAt={entry.startedAt ?? startedAt}
          endedAt={entry.endedAt ?? endedAt}
          active={isRunning}
        />
      </button>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <button
        type="button"
        className="group -mx-half flex min-w-0 items-center gap-base rounded-sm px-half py-0.5 text-left text-sm text-low transition-colors hover:bg-muted/30 hover:text-normal"
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

        <ActivityText active={isRunning} className="min-w-0 flex-1 truncate">
          {headerSummary}
        </ActivityText>
        {detail && (
          <span className="hidden shrink-0 text-xs text-low sm:inline">
            {detail}
          </span>
        )}
        <ChatElapsedTime
          startedAt={startedAt}
          endedAt={endedAt}
          active={isRunning}
        />
      </button>

      {expanded && (
        <div className="ml-6 mt-1 max-h-72 overflow-y-auto rounded-md border border-border bg-muted/10 p-half">
          {entries.map((entry, index) => {
            const outputPreview = entry.command
              ? getOutputPreview(entry.content)
              : null;

            return (
              <button
                key={entry.expansionKey}
                type="button"
                className={cn(
                  'group/item flex w-full min-w-0 items-start gap-base rounded-sm px-base py-half text-left text-sm text-low transition-colors',
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
                <span className="flex min-w-0 flex-1 flex-col gap-quarter">
                  <span className="flex min-w-0 items-center gap-base">
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate',
                        entry.command && 'font-mono text-xs'
                      )}
                    >
                      {entry.summary}
                    </span>
                    <ChatElapsedTime
                      startedAt={entry.startedAt}
                      endedAt={entry.endedAt}
                      active={isActiveStatus(entry.status)}
                    />
                  </span>
                  {outputPreview && (
                    <span className="block max-h-28 overflow-auto rounded-sm bg-panel/80 px-base py-half font-mono text-xs leading-relaxed text-low whitespace-pre-wrap break-words">
                      {outputPreview}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
