import { Workflow } from 'lucide-react';
import { cn } from '../lib/cn';

export type IssueWorkflowAttemptStatusTone =
  | 'draft'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'neutral';

export interface IssueWorkflowAttemptCardData {
  id: string;
  title: string;
  subtitle: string;
  statusLabel: string;
  statusTone: IssueWorkflowAttemptStatusTone;
}

export interface IssueWorkflowAttemptCardProps {
  attempt: IssueWorkflowAttemptCardData;
  onClick?: () => void;
  className?: string;
}

const toneClasses: Record<IssueWorkflowAttemptStatusTone, string> = {
  draft: 'bg-secondary text-low',
  running: 'bg-brand/10 text-brand',
  waiting: 'bg-warning/10 text-warning',
  succeeded: 'bg-success/10 text-success',
  failed: 'bg-error/10 text-error',
  canceled: 'bg-secondary text-low',
  neutral: 'bg-secondary text-low',
};

export function IssueWorkflowAttemptCard({
  attempt,
  onClick,
  className,
}: IssueWorkflowAttemptCardProps) {
  const handleClick = () => {
    onClick?.();
  };

  return (
    <div
      className={cn(
        'rounded-sm border border-brand/20 bg-brand/5 p-base transition-all duration-150',
        onClick && 'cursor-pointer hover:border-brand/40 hover:bg-brand/10',
        className
      )}
      onClick={
        onClick
          ? (event) => {
              event.stopPropagation();
              handleClick();
            }
          : undefined
      }
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                event.stopPropagation();
                handleClick();
              }
            }
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-half">
        <div className="flex min-w-0 items-center gap-half">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-brand/25 bg-brand/10">
            <Workflow className="h-3.5 w-3.5 text-brand" />
          </span>
          <span className="truncate text-sm font-medium text-high">
            {attempt.title}
          </span>
        </div>
        <span
          className={cn(
            'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium',
            toneClasses[attempt.statusTone]
          )}
        >
          {attempt.statusLabel}
        </span>
      </div>

      <div className="mt-half flex items-center gap-half text-xs text-low">
        <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
          <span className="h-1.5 w-1.5 rounded-full bg-brand/70" />
          <span className="h-px w-5 bg-brand/35" />
          <span className="h-1.5 w-1.5 rounded-full bg-brand/45" />
          <span className="h-px w-5 bg-brand/25" />
          <span className="h-1.5 w-1.5 rounded-full bg-brand/35" />
        </span>
        <span className="truncate">{attempt.subtitle}</span>
      </div>
    </div>
  );
}
