import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { Button } from '@vibe/ui/components/Button';
import type { ArenaComparisonCandidate } from '../model/arenaComparisonView';

interface ArenaActionsBarProps {
  candidate: ArenaComparisonCandidate;
  actionError: string | null;
  retryPending: boolean;
  winnerSelectionPending: boolean;
  onRetry: (candidate: ArenaComparisonCandidate) => void;
  onSelectWinner: (
    candidate: ArenaComparisonCandidate,
    trigger: HTMLButtonElement
  ) => void;
}

export function ArenaActionsBar({
  candidate,
  actionError,
  retryPending,
  winnerSelectionPending,
  onRetry,
  onSelectWinner,
}: ArenaActionsBarProps) {
  const { t } = useTranslation('common');

  const handleSelectWinner = (event: MouseEvent<HTMLButtonElement>) => {
    onSelectWinner(candidate, event.currentTarget);
  };

  return (
    <div className="border-t border-[var(--vk-border-subtle)] p-[var(--vk-space-3)]">
      <div className="flex flex-wrap items-center justify-between gap-[var(--vk-space-2)]">
        {candidate.isWinner ? (
          <div className="inline-flex min-h-8 items-center gap-[var(--vk-space-2)] text-[length:var(--vk-font-size-sm)] font-medium text-[var(--vk-status-success)]">
            <CheckCircle2 aria-hidden="true" className="size-4" />
            {t('arena.comparison.winner')}
          </div>
        ) : (
          <span className="text-[length:var(--vk-font-size-sm)] text-[var(--vk-text-low)]">
            {t('arena.comparison.candidate')}
          </span>
        )}

        <div className="flex flex-wrap items-center gap-[var(--vk-space-2)]">
          {candidate.canRetry ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="min-h-11 sm:min-h-8"
              loading={retryPending}
              loadingLabel={t('arena.actions.retrying')}
              disabled={winnerSelectionPending}
              onClick={() => onRetry(candidate)}
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
              {t('arena.actions.retry')}
            </Button>
          ) : null}
          {candidate.canSelectWinner ? (
            <Button
              type="button"
              size="xs"
              className="min-h-11 sm:min-h-8"
              disabled={winnerSelectionPending || retryPending}
              onClick={handleSelectWinner}
            >
              {t('arena.comparison.selectWinner')}
            </Button>
          ) : null}
        </div>
      </div>
      {actionError ? (
        <p
          className="mt-[var(--vk-space-2)] text-[length:var(--vk-font-size-sm)] text-[var(--vk-status-error)]"
          role="alert"
        >
          {actionError}
        </p>
      ) : null}
    </div>
  );
}
