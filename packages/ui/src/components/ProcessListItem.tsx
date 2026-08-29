import { TerminalIcon, GearIcon, GlobeIcon } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { RunningDots } from './RunningDots';

interface ProcessListItemProps {
  runReason: string;
  status: string;
  startedAt: string;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

function getRunReasonLabel(runReason: string): string {
  switch (runReason) {
    case 'setupscript':
      return 'Setup Script';
    case 'cleanupscript':
      return 'Cleanup Script';
    case 'archivescript':
      return 'Archive Script';
    case 'devserver':
      return 'Dev Server';
    default:
      return runReason;
  }
}

function getRunReasonIcon(runReason: string): typeof TerminalIcon {
  switch (runReason) {
    case 'setupscript':
    case 'cleanupscript':
    case 'archivescript':
      return GearIcon;
    case 'devserver':
      return GlobeIcon;
    default:
      return TerminalIcon;
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'starting':
    case 'running':
    case 'waiting_approval':
    case 'waiting_input':
    case 'cancelling':
      return 'bg-info';
    case 'completed':
      return 'bg-success';
    case 'failed':
    case 'crashed':
      return 'bg-destructive';
    case 'killed':
      return 'bg-low';
    default:
      return 'bg-low';
  }
}

function formatRelativeElapsed(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export function ProcessListItem({
  runReason,
  status,
  startedAt,
  selected,
  onClick,
  className,
}: ProcessListItemProps) {
  const IconComponent = getRunReasonIcon(runReason);
  const label = getRunReasonLabel(runReason);
  const statusColor = getStatusColor(status);

  const isRunning =
    status === 'starting' ||
    status === 'running' ||
    status === 'waiting_approval' ||
    status === 'waiting_input' ||
    status === 'cancelling';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full h-[26px] flex items-center gap-half px-half rounded-sm text-left transition-colors',
        className
      )}
    >
      <IconComponent
        className="size-icon-sm flex-shrink-0 text-low"
        weight="regular"
      />
      {isRunning ? (
        <RunningDots />
      ) : (
        <span
          className={cn('size-dot rounded-full flex-shrink-0', statusColor)}
          title={status}
        />
      )}
      <span
        className={cn(
          'text-sm truncate flex-1',
          selected ? 'text-high' : 'text-normal'
        )}
      >
        {label}
      </span>
      <span className="text-xs text-low flex-shrink-0">
        {formatRelativeElapsed(startedAt)}
      </span>
    </button>
  );
}
