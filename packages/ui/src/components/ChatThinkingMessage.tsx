import type { ReactNode } from 'react';
import { ChatDotsIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { ActivityText } from './ActivityText';
import { ChatElapsedTime } from './ChatElapsedTime';

export interface ChatThinkingMessageRenderProps {
  content: string;
  workspaceId?: string;
  className?: string;
}

interface ChatThinkingMessageProps {
  content: string;
  className?: string;
  workspaceId?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  active?: boolean;
  renderMarkdown: (props: ChatThinkingMessageRenderProps) => ReactNode;
}

export function ChatThinkingMessage({
  content,
  className,
  workspaceId,
  startedAt,
  endedAt,
  active = !endedAt,
  renderMarkdown,
}: ChatThinkingMessageProps) {
  const { t } = useTranslation('common');

  return (
    <div
      className={cn('flex items-start gap-base text-sm text-low', className)}
    >
      <ChatDotsIcon className="shrink-0 size-icon-base pt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="mb-quarter flex min-w-0 items-center gap-base">
          <ActivityText className="min-w-0 flex-1 truncate text-sm font-medium">
            {t('conversation.thinking')}
          </ActivityText>
          <ChatElapsedTime
            startedAt={startedAt}
            endedAt={endedAt}
            active={active}
          />
        </div>
        {renderMarkdown({
          content,
          workspaceId: workspaceId,
          className: 'text-sm',
        })}
      </div>
    </div>
  );
}
