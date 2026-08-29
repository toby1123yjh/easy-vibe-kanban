import type { CSSProperties, HTMLAttributes } from 'react';

import { cn } from '../lib/cn';

export type SemanticStatus =
  | 'running'
  | 'waiting'
  | 'success'
  | 'error'
  | 'cancelled'
  | 'workflow';

export interface StatusDotProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'color'> {
  color?: string;
  status?: SemanticStatus;
  label?: string;
  pulse?: boolean;
  selected?: boolean;
}

const semanticStatusColors: Record<SemanticStatus, string> = {
  running: 'var(--vk-status-running)',
  waiting: 'var(--vk-status-waiting)',
  success: 'var(--vk-status-success)',
  error: 'var(--vk-status-error)',
  cancelled: 'var(--vk-status-cancelled)',
  workflow: 'var(--vk-status-workflow)',
};

function resolveStatusColor(color: string | undefined, status: SemanticStatus) {
  if (!color) {
    return semanticStatusColors[status];
  }

  return /^(#|rgb|hsl|oklch|color|var)\(/.test(color) || color.startsWith('#')
    ? color
    : `hsl(${color})`;
}

export function StatusDot({
  color,
  status = 'cancelled',
  label,
  pulse = false,
  selected = false,
  className,
  style,
  ...props
}: StatusDotProps) {
  const dotStyle = {
    ...style,
    '--vk-status-dot-color': resolveStatusColor(color, status),
  } as CSSProperties;

  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      data-status={status}
      data-selected={selected || undefined}
      className={cn(
        'relative inline-flex size-[var(--vk-status-dot-size)] shrink-0 rounded-full',
        'bg-[var(--vk-status-dot-color)]',
        'data-[selected=true]:ring-2 data-[selected=true]:ring-[var(--vk-selection-ring)] data-[selected=true]:ring-offset-2 data-[selected=true]:ring-offset-[var(--vk-surface-primary)]',
        className
      )}
      style={dotStyle}
      {...props}
    >
      {pulse && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-full bg-[var(--vk-status-dot-color)] opacity-50 motion-safe:animate-ping"
        />
      )}
    </span>
  );
}
