import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

interface WorkspaceFileEmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function WorkspaceFileEmptyState({
  icon,
  title,
  description,
  action,
  className,
}: WorkspaceFileEmptyStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-0 flex-1 items-center justify-center p-double text-center',
        className
      )}
    >
      <div className="flex max-w-[320px] flex-col items-center gap-base">
        {icon && (
          <div className="flex size-10 items-center justify-center rounded border border-border bg-secondary text-low">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <div className="text-base font-semibold text-high">{title}</div>
          {description && (
            <div className="mt-half text-sm leading-relaxed text-low">
              {description}
            </div>
          )}
        </div>
        {action}
      </div>
    </div>
  );
}
