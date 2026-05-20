import { GitBranch, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation('common');

  return (
    <div className="my-half rounded border border-secondary bg-panel/70 p-half shadow-sm">
      <div className="flex items-center gap-half px-half pt-half">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-brand/30 bg-brand/10">
          <GitBranch className="h-4 w-4 text-brand" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-high">
            {t('workflow.entry.title')}
          </div>
          <div className="mt-0.5 text-xs text-low">
            {t('workflow.entry.subtitle')}
          </div>
        </div>
      </div>

      <div className="mt-half grid grid-cols-[minmax(0,1fr)_auto] gap-half">
        <button
          type="button"
          onClick={onOpenCanvas}
          disabled={isCreating}
          className="flex h-10 min-w-0 cursor-pointer items-center justify-center gap-half rounded border border-brand/50 bg-brand/10 px-base text-sm font-medium text-high transition-colors hover:bg-brand/15 focus:outline-none focus:ring-1 focus:ring-brand disabled:cursor-not-allowed disabled:opacity-60"
          aria-label={t('workflow.entry.openCanvasAria')}
        >
          {isCreating ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" />
          ) : (
            <GitBranch className="h-4 w-4 shrink-0 text-brand" />
          )}
          <span className="truncate">{t('workflow.entry.openCanvas')}</span>
        </button>
        <button
          type="button"
          onClick={onRunExisting}
          className="flex h-10 cursor-pointer items-center justify-center gap-half rounded border border-secondary bg-primary px-half text-sm font-medium text-normal transition-colors hover:border-brand/60 hover:text-high focus:outline-none focus:ring-1 focus:ring-brand"
          aria-label={t('workflow.entry.openCanvasAria')}
        >
          <GitBranch className="h-4 w-4 shrink-0 text-brand" />
          <span>{t('workflow.entry.openCanvas')}</span>
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
