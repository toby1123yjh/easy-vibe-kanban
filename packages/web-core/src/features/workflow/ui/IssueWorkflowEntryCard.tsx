import { GitBranch, Loader2 } from 'lucide-react';
import { ISSUE_WORKFLOW_ENTRY_COPY } from '../model/issueWorkflow';

export interface IssueWorkflowEntryCardProps {
  isCreating: boolean;
  error?: string | null;
  onOpenCanvas(): void;
  onRunExisting(): void;
}

export function IssueWorkflowEntryCard({
  isCreating,
  error,
  onOpenCanvas,
  onRunExisting,
}: IssueWorkflowEntryCardProps) {
  return (
    <div className="my-half rounded border border-secondary bg-panel/70 p-half shadow-sm">
      <div className="flex items-center gap-half px-half pt-half">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-brand/30 bg-brand/10">
          <GitBranch className="h-4 w-4 text-brand" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-high">
            {ISSUE_WORKFLOW_ENTRY_COPY.title}
          </div>
          <div className="mt-0.5 text-xs text-low">
            {ISSUE_WORKFLOW_ENTRY_COPY.subtitle}
          </div>
        </div>
      </div>

      <div className="mt-half grid grid-cols-[minmax(0,1fr)_auto] gap-half">
        <button
          type="button"
          onClick={onOpenCanvas}
          disabled={isCreating}
          className="flex h-10 min-w-0 cursor-pointer items-center justify-center gap-half rounded border border-brand/50 bg-brand/10 px-base text-sm font-medium text-high transition-colors hover:bg-brand/15 focus:outline-none focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={ISSUE_WORKFLOW_ENTRY_COPY.primaryActionAriaLabel}
        >
          {isCreating ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" />
          ) : (
            <GitBranch className="h-4 w-4 shrink-0 text-brand" />
          )}
          <span className="truncate">
            {ISSUE_WORKFLOW_ENTRY_COPY.primaryActionLabel}
          </span>
        </button>
        <button
          type="button"
          onClick={onRunExisting}
          className="flex h-10 cursor-pointer items-center justify-center gap-half rounded border border-secondary bg-primary px-half text-sm font-medium text-normal transition-colors hover:border-brand/60 hover:text-high focus:outline-none focus:ring-1 focus:ring-brand"
          aria-label={ISSUE_WORKFLOW_ENTRY_COPY.secondaryActionAriaLabel}
        >
          <GitBranch className="h-4 w-4 shrink-0 text-brand" />
          <span>{ISSUE_WORKFLOW_ENTRY_COPY.secondaryActionLabel}</span>
        </button>
      </div>

      {error ? (
        <p className="mt-half px-half text-xs text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
