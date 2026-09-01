import type { HTMLAttributes, ReactNode } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Inbox,
  LoaderCircle,
  ShieldAlert,
  WifiOff,
} from 'lucide-react';

import { cn } from '../lib/cn';

/** Shared semantic state vocabulary used by pages and section boundaries. */
export type StateSurfaceState =
  | 'loading'
  | 'empty'
  | 'error'
  | 'offline'
  | 'permission'
  | 'degraded';

export interface StateSurfaceProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  state: StateSurfaceState;
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function StateSurface({
  state,
  icon,
  title,
  description,
  action,
  compact = false,
  className,
  ...props
}: StateSurfaceProps) {
  const fallbackIcon = {
    loading: (
      <LoaderCircle
        aria-hidden="true"
        className="animate-spin motion-reduce:animate-none"
      />
    ),
    empty: <Inbox aria-hidden="true" />,
    error: <AlertCircle aria-hidden="true" />,
    offline: <WifiOff aria-hidden="true" />,
    permission: <ShieldAlert aria-hidden="true" />,
    degraded: <AlertTriangle aria-hidden="true" />,
  }[state];

  const stateClasses = {
    loading: 'text-[var(--vk-text-low)]',
    empty: 'text-[var(--vk-empty-state-text)]',
    error:
      'rounded-[var(--vk-radius-md)] bg-[var(--vk-error-state-surface)] text-[var(--vk-error-state-text)]',
    offline:
      'rounded-[var(--vk-radius-md)] bg-[var(--vk-status-cancelled-subtle)] text-[var(--vk-status-cancelled-text)]',
    permission:
      'rounded-[var(--vk-radius-md)] bg-[var(--vk-status-workflow-subtle)] text-[var(--vk-permission-required)]',
    degraded:
      'rounded-[var(--vk-radius-md)] bg-[var(--vk-status-waiting-subtle)] text-[var(--vk-status-waiting-text)]',
  }[state];

  const announcementProps = {
    loading: {
      role: 'status' as const,
      'aria-live': 'polite' as const,
      'aria-atomic': true,
      'aria-busy': true,
    },
    error: {
      role: 'alert' as const,
      'aria-live': 'assertive' as const,
      'aria-atomic': true,
    },
    offline: {
      role: 'status' as const,
      'aria-live': 'polite' as const,
      'aria-atomic': true,
    },
    empty: {},
    permission: {},
    degraded: {},
  }[state];

  return (
    <div
      {...announcementProps}
      data-state={state}
      className={cn(
        'flex min-w-0 flex-col items-center justify-center text-center',
        compact
          ? 'gap-[var(--vk-space-2)] p-[var(--vk-space-3)]'
          : 'gap-[var(--vk-space-3)] p-[var(--vk-space-6)]',
        stateClasses,
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

export type EmptyStateProps = Omit<StateSurfaceProps, 'state'>;

export function EmptyState(props: EmptyStateProps) {
  return <StateSurface state="empty" {...props} />;
}

export type ErrorStateProps = Omit<StateSurfaceProps, 'state'>;

export function ErrorState(props: ErrorStateProps) {
  return <StateSurface state="error" {...props} />;
}

type NamedStateProps = Omit<StateSurfaceProps, 'state'>;

export function LoadingState(props: NamedStateProps) {
  return <StateSurface state="loading" {...props} />;
}

export function OfflineState(props: NamedStateProps) {
  return <StateSurface state="offline" {...props} />;
}

export function PermissionState(props: NamedStateProps) {
  return <StateSurface state="permission" {...props} />;
}

export function DegradedState(props: NamedStateProps) {
  return <StateSurface state="degraded" {...props} />;
}
