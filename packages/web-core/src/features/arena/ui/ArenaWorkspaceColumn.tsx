import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ExternalLink,
  FileCheck2,
  FileDiff,
  GitBranch,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@vibe/ui/components/Button';
import { useDiffSummary } from '@/shared/hooks/useDiffSummary';
import { agentRunsApi } from '@/shared/lib/agentRunApi';
import { buildWorkspaceSessionHref } from '@/shared/lib/routes/workspaceRoutes';
import { cn } from '@/shared/lib/utils';
import {
  getArenaAgentRunResultSummary,
  selectCurrentArenaAgentRun,
  type ArenaComparisonCandidate,
} from '../model/arenaComparisonView';
import { ArenaActionsBar } from './ArenaActionsBar';

interface ArenaWorkspaceColumnProps {
  candidate: ArenaComparisonCandidate;
  detailHref?: string;
  actionError: string | null;
  retryPending: boolean;
  winnerSelectionPending: boolean;
  onRetry: (candidate: ArenaComparisonCandidate) => void;
  onSelectWinner: (
    candidate: ArenaComparisonCandidate,
    trigger: HTMLButtonElement
  ) => void;
}

export function ArenaWorkspaceColumn({
  candidate,
  detailHref,
  actionError,
  retryPending,
  winnerSelectionPending,
  onRetry,
  onSelectWinner,
}: ArenaWorkspaceColumnProps) {
  const { t } = useTranslation('common');
  const diff = useDiffSummary(candidate.workspaceId);
  const runsQuery = useQuery({
    queryKey: ['agent-runs', 'session', candidate.sessionId],
    queryFn: () => agentRunsApi.listForSession(candidate.sessionId!),
    enabled: Boolean(candidate.sessionId),
    refetchInterval: candidate.canCancel ? 2_000 : false,
  });
  const currentRun = selectCurrentArenaAgentRun(runsQuery.data ?? []);
  const resultSummary = getArenaAgentRunResultSummary(currentRun);
  const statusKey = candidate.agentRunStatus ?? 'not_started';
  const sessionHref = buildWorkspaceSessionHref(
    detailHref,
    candidate.sessionId
  );

  return (
    <article
      className={cn(
        'flex min-h-[32rem] min-w-0 flex-col overflow-hidden rounded-[var(--vk-radius-lg)]',
        'border bg-[var(--vk-surface-secondary)]',
        candidate.isWinner
          ? 'border-[var(--vk-status-success)]'
          : 'border-[var(--vk-border-subtle)]'
      )}
    >
      <header className="border-b border-[var(--vk-border-subtle)] p-[var(--vk-space-4)]">
        <div className="flex items-start justify-between gap-[var(--vk-space-3)]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-[var(--vk-space-2)]">
              <h3 className="truncate text-[length:var(--vk-font-size-md)] font-semibold text-[var(--vk-text-high)]">
                {candidate.label}
              </h3>
              <span className="rounded-[var(--vk-radius-sm)] bg-[var(--vk-status-running-subtle)] px-[var(--vk-space-2)] py-[var(--vk-space-1)] text-[length:var(--vk-font-size-2xs)] text-[var(--vk-status-running-text)]">
                {t(`arena.purpose.${candidate.purpose}`)}
              </span>
            </div>
            <p className="mt-[var(--vk-space-1)] truncate text-[length:var(--vk-font-size-sm)] text-[var(--vk-text-low)]">
              {candidate.executorLabel || t('arena.comparison.unknownExecutor')}
            </p>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-full px-[var(--vk-space-2)] py-[var(--vk-space-1)]',
              'text-[length:var(--vk-font-size-2xs)] font-medium',
              candidate.isSuccessful
                ? 'bg-[var(--vk-status-success-subtle)] text-[var(--vk-status-success)]'
                : candidate.canCancel
                  ? 'bg-[var(--vk-status-running-subtle)] text-[var(--vk-status-running-text)]'
                  : 'bg-[var(--vk-surface-tertiary)] text-[var(--vk-text-low)]'
            )}
          >
            {t(`arena.agentStatus.${statusKey}`)}
          </span>
        </div>
        <div className="mt-[var(--vk-space-3)] flex min-w-0 items-center gap-[var(--vk-space-2)] text-[length:var(--vk-font-size-sm)] text-[var(--vk-text-low)]">
          <GitBranch aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate font-mono">{candidate.branch}</span>
        </div>
      </header>

      <div className="flex-1 space-y-[var(--vk-space-4)] overflow-y-auto p-[var(--vk-space-4)]">
        <section aria-labelledby={`arena-summary-${candidate.candidateId}`}>
          <h4
            id={`arena-summary-${candidate.candidateId}`}
            className="text-[length:var(--vk-font-size-sm)] font-medium text-[var(--vk-text-high)]"
          >
            {t('arena.resultSummary.title')}
          </h4>
          <div className="mt-[var(--vk-space-2)] rounded-[var(--vk-radius-md)] border border-[var(--vk-border-subtle)] bg-[var(--vk-surface-primary)] p-[var(--vk-space-3)]">
            {runsQuery.isLoading ? (
              <p className="text-[length:var(--vk-font-size-sm)] text-[var(--vk-text-low)]">
                {t('arena.resultSummary.loading')}
              </p>
            ) : runsQuery.error ? (
              <p
                className="text-[length:var(--vk-font-size-sm)] text-[var(--vk-status-error)]"
                role="alert"
              >
                {t('arena.resultSummary.loadFailed')}
              </p>
            ) : resultSummary ? (
              <p className="max-h-36 overflow-y-auto whitespace-pre-wrap text-[length:var(--vk-font-size-sm)] leading-relaxed text-[var(--vk-text-normal)]">
                {resultSummary}
              </p>
            ) : (
              <p className="text-[length:var(--vk-font-size-sm)] text-[var(--vk-text-low)]">
                {candidate.canCancel
                  ? t('arena.resultSummary.running')
                  : t('arena.resultSummary.empty')}
              </p>
            )}
          </div>
        </section>

        <section className="grid gap-[var(--vk-space-2)] sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <div className="rounded-[var(--vk-radius-md)] border border-[var(--vk-border-subtle)] bg-[var(--vk-surface-primary)] p-[var(--vk-space-3)]">
            <div className="flex items-center gap-[var(--vk-space-2)] text-[length:var(--vk-font-size-sm)] font-medium text-[var(--vk-text-high)]">
              <FileDiff aria-hidden="true" className="size-4" />
              {t('arena.diff.title')}
            </div>
            {diff.error ? (
              <p className="mt-[var(--vk-space-2)] text-[length:var(--vk-font-size-sm)] text-[var(--vk-status-error)]">
                {t('arena.diff.unavailable')}
              </p>
            ) : (
              <p className="mt-[var(--vk-space-2)] text-[length:var(--vk-font-size-sm)] text-[var(--vk-text-low)]">
                {t('arena.diff.summary', { count: diff.fileCount })}{' '}
                <span className="text-[var(--vk-status-success)]">
                  +{diff.added}
                </span>{' '}
                <span className="text-[var(--vk-status-error)]">
                  -{diff.deleted}
                </span>
              </p>
            )}
          </div>
          <div className="rounded-[var(--vk-radius-md)] border border-[var(--vk-border-subtle)] bg-[var(--vk-surface-primary)] p-[var(--vk-space-3)]">
            <div className="flex items-center gap-[var(--vk-space-2)] text-[length:var(--vk-font-size-sm)] font-medium text-[var(--vk-text-high)]">
              <FileCheck2 aria-hidden="true" className="size-4" />
              {t('arena.tests.title')}
            </div>
            <p className="mt-[var(--vk-space-2)] text-[length:var(--vk-font-size-sm)] text-[var(--vk-text-low)]">
              {candidate.canCancel
                ? t('arena.tests.running')
                : t('arena.tests.empty')}
            </p>
          </div>
        </section>

        <div className="flex flex-wrap gap-[var(--vk-space-2)]">
          {sessionHref ? (
            <Button asChild size="xs" variant="outline">
              <a href={sessionHref}>
                <MessageSquare aria-hidden="true" className="size-3.5" />
                {t('arena.comparison.openSession')}
              </a>
            </Button>
          ) : null}
          {detailHref ? (
            <Button asChild size="xs" variant="ghost">
              <a href={detailHref}>
                <ExternalLink aria-hidden="true" className="size-3.5" />
                {t('arena.comparison.openDiff')}
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      <ArenaActionsBar
        candidate={candidate}
        actionError={actionError}
        retryPending={retryPending}
        winnerSelectionPending={winnerSelectionPending}
        onRetry={onRetry}
        onSelectWinner={onSelectWinner}
      />
    </article>
  );
}
