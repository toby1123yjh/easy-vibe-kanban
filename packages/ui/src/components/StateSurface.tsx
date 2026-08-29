import type { HTMLAttributes, ReactNode } from 'react';
import { AlertCircle, Inbox } from 'lucide-react';

import { cn } from '../lib/cn';

export type StateSurfaceTone = 'empty' | 'error';

export interface StateSurfaceProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: StateSurfaceTone;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function StateSurface({
  tone = 'empty',
  icon,
  title,
  description,
  action,
  compact = false,
  className,
  ...props
}: StateSurfaceProps) {
  const isError = tone === 'error';
  const fallbackIcon = isError ? (
    <AlertCircle aria-hidden="true" />
  ) : (
    <Inbox aria-hidden="true" />
  );

  return (
    <div
      role={isError ? 'alert' : 'status'}
      className={cn(
        'flex min-w-0 flex-col items-center justify-center text-center',
        compact
          ? 'gap-[var(--vk-space-2)] p-[var(--vk-space-3)]'
          : 'gap-[var(--vk-space-3)] p-[var(--vk-space-6)]',
        isError
          ? 'rounded-[var(--vk-radius-md)] bg-[var(--vk-error-state-surface)] text-[var(--vk-error-state-text)]'
          : 'text-[var(--vk-empty-state-text)]',
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center [&_svg]:size-6"
      >
        {icon ?? fallbackIcon}
      </span>
      <div className="min-w-0 max-w-prose">
        <div className="break-words text-[length:var(--vk-font-size-sm)] font-semibold leading-[var(--vk-line-height-sm)] text-[var(--vk-text-high)]">
          {title}
        </div>
        {description && (
          <div className="mt-[var(--vk-space-1)] break-words text-[length:var(--vk-font-size-sm)] leading-[var(--vk-line-height-sm)] text-[var(--vk-text-normal)]">
            {description}
          </div>
        )}
      </div>
      {action && <div className="max-w-full">{action}</div>}
    </div>
  );
}

export type EmptyStateProps = Omit<StateSurfaceProps, 'tone'>;

export function EmptyState(props: EmptyStateProps) {
  return <StateSurface tone="empty" {...props} />;
}

export type ErrorStateProps = Omit<StateSurfaceProps, 'tone'>;

export function ErrorState(props: ErrorStateProps) {
  return <StateSurface tone="error" {...props} />;
}
