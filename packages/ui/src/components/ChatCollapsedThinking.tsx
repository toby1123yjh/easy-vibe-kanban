import type { ReactNode } from 'react';
import { ChatDotsIcon, CaretRightIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { ActivityText } from './ActivityText';
import { ChatElapsedTime } from './ChatElapsedTime';

export interface ThinkingEntry {
  content: string;
  expansionKey: string;
  startedAt?: string | null;
  endedAt?: string | null;
}

export interface ChatCollapsedThinkingRenderProps {
  content: string;
  workspaceId?: string;
  className?: string;
}

interface ChatCollapsedThinkingProps {
  entries: ThinkingEntry[];
  expanded: boolean;
  isHovered: boolean;
  onToggle: () => void;
  onHoverChange: (hovered: boolean) => void;
  className?: string;
  workspaceId?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  renderMarkdown: (props: ChatCollapsedThinkingRenderProps) => ReactNode;
}

/**
 * A collapsible group for thinking entries in previous conversation turns.
 * When collapsed, shows "Thinking" with the thinking icon.
 * When expanded, shows all thinking entries with their full content.
 */
export function ChatCollapsedThinking({
  entries,
  expanded,
  isHovered,
  onToggle,
  onHoverChange,
  className,
  workspaceId,
  startedAt,
  endedAt,
  renderMarkdown,
}: ChatCollapsedThinkingProps) {
  const { t } = useTranslation('common');

  if (entries.length === 0) return null;

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Header row - clickable to expand/collapse */}
      <button
        type="button"
        className="group -mx-half flex min-w-0 items-center gap-base rounded-sm px-half py-0.5 text-left text-sm text-low transition-colors hover:bg-muted/30 hover:text-normal"
        onClick={onToggle}
        onMouseEnter={() => onHoverChange(true)}
        onMouseLeave={() => onHoverChange(false)}
        aria-expanded={expanded}
        data-scroll-anchor-target=""
      >
        <span className="shrink-0 pt-0.5">
          {isHovered ? (
            <CaretRightIcon
              className={cn(
                'size-icon-base transition-transform duration-150',
                expanded && 'rotate-90'
              )}
            />
          ) : (
            <ChatDotsIcon className="size-icon-base" />
          )}
        </span>
        <ActivityText active={false} className="min-w-0 flex-1 truncate">
          {t('conversation.processed')}
        </ActivityText>
        <ChatElapsedTime startedAt={startedAt} endedAt={endedAt} />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="ml-6 mt-1 flex max-h-72 flex-col gap-base overflow-y-auto rounded-md border border-border bg-muted/10 p-base">
          {entries.map((entry) => (
            <div key={entry.expansionKey} className="text-sm text-low">
              {renderMarkdown({
                content: entry.content,
                workspaceId: workspaceId,
                className: 'text-sm',
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
