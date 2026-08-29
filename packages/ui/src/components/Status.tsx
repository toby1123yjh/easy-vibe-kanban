import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';
import { StatusDot, type SemanticStatus } from './StatusDot';

export interface StatusProps extends HTMLAttributes<HTMLSpanElement> {
  status: SemanticStatus;
  label: ReactNode;
  pulse?: boolean;
  selected?: boolean;
}

const statusTextClasses: Record<SemanticStatus, string> = {
  running: 'text-[var(--vk-status-running-text)]',
  waiting: 'text-[var(--vk-status-waiting-text)]',
  success: 'text-[var(--vk-status-success-text)]',
  error: 'text-[var(--vk-status-error-text)]',
  cancelled: 'text-[var(--vk-status-cancelled-text)]',
  workflow: 'text-[var(--vk-status-workflow-text)]',
};

export function Status({
  status,
  label,
  pulse = false,
  selected = false,
  className,
  ...props
}: StatusProps) {
  return (
    <span
      role="status"
      data-status={status}
      data-selected={selected || undefined}
      className={cn(
        'inline-flex max-w-full items-center gap-[var(--vk-space-2)] rounded-[var(--vk-radius-sm)]',
        'text-[length:var(--vk-font-size-xs)] font-medium leading-[var(--vk-line-height-xs)]',
        'data-[selected=true]:ring-2 data-[selected=true]:ring-[var(--vk-selection-ring)] data-[selected=true]:ring-offset-2 data-[selected=true]:ring-offset-[var(--vk-surface-primary)]',
        statusTextClasses[status],
        className
      )}
      {...props}
    >
      <StatusDot status={status} pulse={pulse} />
      <span className="min-w-0 break-words">{label}</span>
    </span>
  );
}
