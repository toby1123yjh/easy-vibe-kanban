import type { ReactNode } from 'react';
import { ChatDotsIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { cn } from '../lib/cn';
import { ActivityText } from './ActivityText';

export interface ChatThinkingMessageRenderProps {
  content: string;
  workspaceId?: string;
  className?: string;
}

interface ChatThinkingMessageProps {
  content: string;
  className?: string;
  workspaceId?: string;
  renderMarkdown: (props: ChatThinkingMessageRenderProps) => ReactNode;
}

export function ChatThinkingMessage({
  content,
  className,
  workspaceId,
  renderMarkdown,
}: ChatThinkingMessageProps) {
  const { t } = useTranslation('common');

  return (
    <div
      className={cn('flex items-start gap-base text-sm text-low', className)}
    >
      <ChatDotsIcon className="shrink-0 size-icon-base pt-0.5" />
      <div className="min-w-0 flex-1">
        <ActivityText className="mb-quarter block text-sm font-medium">
          {t('conversation.thinking')}
        </ActivityText>
        {renderMarkdown({
          content,
          workspaceId: workspaceId,
          className: 'text-sm',
        })}
      </div>
    </div>
  );
}
