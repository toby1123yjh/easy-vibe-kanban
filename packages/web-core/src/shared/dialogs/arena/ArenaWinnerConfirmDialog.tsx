import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { GitBranch, Layers3 } from 'lucide-react';
import { Button } from '@vibe/ui/components/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { useDiffSummary } from '@/shared/hooks/useDiffSummary';

export interface ArenaWinnerConfirmationCandidate {
  candidateId: string;
  workspaceId: string;
  label: string;
  executorLabel: string;
  branch: string;
  purpose: 'attempt' | 'synthesis';
}

interface ArenaWinnerConfirmDialogProps {
  candidate: ArenaWinnerConfirmationCandidate | null;
  archiveSiblingCount: number | null;
  outcome: 'adopt' | 'start-implementation' | 'workflow';
  open: boolean;
  isPending: boolean;
  error: string | null;
  returnFocusTarget: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

export function ArenaWinnerConfirmDialog({
  candidate,
  archiveSiblingCount,
  outcome,
  open,
  isPending,
  error,
  returnFocusTarget,
  onOpenChange,
  onConfirm,
}: ArenaWinnerConfirmDialogProps) {
  const { t } = useTranslation('common');
  const wasOpenRef = useRef(open);
  const submissionLockRef = useRef(false);
  const diff = useDiffSummary(candidate?.workspaceId ?? null);

  const handleConfirm = async () => {
    if (submissionLockRef.current || isPending) return;
    submissionLockRef.current = true;
    try {
      await onConfirm();
    } finally {
      submissionLockRef.current = false;
    }
  };

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      requestAnimationFrame(() => returnFocusTarget?.focus());
    }
    wasOpenRef.current = open;
  }, [open, returnFocusTarget]);

  if (!candidate) return null;

  return (
    <Dialog
      open={open}
      uncloseable={isPending}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {t('arena.winnerConfirm.title', { candidate: candidate.label })}
          </DialogTitle>
          <DialogDescription className="text-left">
            {t('arena.winnerConfirm.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-[var(--vk-space-3)]">
          <div className="rounded-[var(--vk-radius-md)] border border-[var(--vk-border-subtle)] bg-[var(--vk-surface-secondary)] p-[var(--vk-space-3)]">
            <div className="flex flex-wrap items-center gap-[var(--vk-space-2)]">
              <span className="font-medium text-[var(--vk-text-high)]">
                {candidate.label}
              </span>
              <span className="rounded-[var(--vk-radius-sm)] bg-[var(--vk-status-running-subtle)] px-[var(--vk-space-2)] py-[var(--vk-space-1)] text-[length:var(--vk-font-size-2xs)] text-[var(--vk-status-running-text)]">
                {t(`arena.purpose.${candidate.purpose}`)}
              </span>
            </div>
            <p className="mt-[var(--vk-space-1)] text-[length:var(--vk-font-size-sm)] text-[var(--vk-text-low)]">
              {candidate.executorLabel || t('arena.comparison.unknownExecutor')}
            </p>
            <div className="mt-[var(--vk-space-2)] flex min-w-0 items-center gap-[var(--vk-space-2)] text-[length:var(--vk-font-size-sm)] text-[var(--vk-text-low)]">
              <GitBranch aria-hidden="true" className="size-4 shrink-0" />
              <span className="truncate font-mono">{candidate.branch}</span>
            </div>
          </div>

          <dl className="grid gap-[var(--vk-space-2)] text-[length:var(--vk-font-size-sm)] sm:grid-cols-2">
            <div className="rounded-[var(--vk-radius-sm)] border border-[var(--vk-border-subtle)] p-[var(--vk-space-2)]">
              <dt className="text-[var(--vk-text-low)]">
                {t('arena.winnerConfirm.changedFiles')}
              </dt>
              <dd className="mt-[var(--vk-space-1)] font-medium tabular-nums text-[var(--vk-text-high)]">
                {diff.error
                  ? t('arena.winnerConfirm.unavailable')
                  : diff.fileCount}
              </dd>
            </div>
            {archiveSiblingCount !== null ? (
              <div className="rounded-[var(--vk-radius-sm)] border border-[var(--vk-border-subtle)] p-[var(--vk-space-2)]">
                <dt className="text-[var(--vk-text-low)]">
                  {t('arena.winnerConfirm.archivedCandidates')}
                </dt>
                <dd className="mt-[var(--vk-space-1)] font-medium tabular-nums text-[var(--vk-text-high)]">
                  {archiveSiblingCount}
                </dd>
              </div>
            ) : (
              <div className="rounded-[var(--vk-radius-sm)] border border-[var(--vk-border-subtle)] p-[var(--vk-space-2)]">
                <dt className="text-[var(--vk-text-low)]">
                  {t('arena.winnerConfirm.otherCandidates')}
                </dt>
                <dd className="mt-[var(--vk-space-1)] font-medium text-[var(--vk-text-high)]">
                  {t('arena.winnerConfirm.remainAvailable')}
                </dd>
              </div>
            )}
          </dl>

          {outcome !== 'adopt' ? (
            <div className="flex items-start gap-[var(--vk-space-2)] rounded-[var(--vk-radius-sm)] border border-[var(--vk-status-waiting)] bg-[var(--vk-status-waiting-subtle)] p-[var(--vk-space-2)] text-[length:var(--vk-font-size-sm)] text-[var(--vk-text-high)]">
              <Layers3 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t(
                outcome === 'workflow'
                  ? 'arena.winnerConfirm.workflowImpact'
                  : 'arena.winnerConfirm.implementationImpact'
              )}
            </div>
          ) : null}

          {error ? (
            <p
              className="text-[length:var(--vk-font-size-sm)] text-[var(--vk-status-error)]"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            autoFocus
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            {t('buttons.cancel')}
          </Button>
          <Button
            type="button"
            loading={isPending}
            disabled={isPending}
            loadingLabel={t('arena.winnerConfirm.applying')}
            onClick={() => void handleConfirm()}
          >
            {outcome === 'workflow'
              ? t('arena.winnerConfirm.applyAndContinue')
              : outcome === 'start-implementation'
                ? t('arena.winnerConfirm.startImplementation')
                : t('arena.winnerConfirm.adopt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
