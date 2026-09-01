import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal, OctagonX, Sparkles } from 'lucide-react';
import { BaseCodingAgent, type ExecutorConfig } from 'shared/types';
import { Button } from '@vibe/ui/components/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@vibe/ui/components/DropdownMenu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@vibe/ui/components/Select';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { useArenaActions } from '@/shared/hooks/useArenaActions';
import { useArenaGroup } from '@/shared/hooks/useArenaGroup';
import type {
  ArenaWorkspaceSummary,
  RetryArenaRequest,
} from '@/shared/lib/arenaApi';
import { cn } from '@/shared/lib/utils';
import {
  buildArenaComparisonView,
  reconcileArenaCandidateSelection,
  type ArenaComparisonCandidate,
} from '../model/arenaComparisonView';
import { ArenaWinnerConfirmDialog } from '@/shared/dialogs/arena/ArenaWinnerConfirmDialog';
import { ArenaWorkspaceColumn } from './ArenaWorkspaceColumn';
import { SynthesizeArenaDialog } from './SynthesizeArenaDialog';

interface ArenaViewProps {
  groupId: string;
  buildWorkspaceHref?: (workspaceId: string) => string | undefined;
  onDissolved?: () => void;
}

function useComparisonWidth() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!element) return;
    const update = () => setWidth(element.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return { setElement, width };
}

function executorConfigForWorkspace(
  workspace: ArenaWorkspaceSummary | undefined
): ExecutorConfig {
  return {
    executor:
      (workspace?.executor as BaseCodingAgent | undefined) ??
      BaseCodingAgent.CODEX,
    variant: workspace?.variant ?? null,
    model_id: null,
    agent_id: null,
    reasoning_id: null,
    permission_policy: null,
  };
}

export function ArenaView({
  groupId,
  buildWorkspaceHref,
  onDissolved,
}: ArenaViewProps) {
  const { t } = useTranslation('common');
  const arenaQuery = useArenaGroup(groupId);
  const actions = useArenaActions(groupId, null);
  const comparisonWidth = useComparisonWidth();
  const comparison = useMemo(
    () =>
      arenaQuery.data
        ? buildArenaComparisonView(arenaQuery.data, {
            attempt: (order) =>
              t('arena.workspace.attemptName', { index: order }),
            synthesis: (order) => `${t('arena.purpose.synthesis')} ${order}`,
          })
        : null,
    [arenaQuery.data, t]
  );
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    null
  );
  const [winnerCandidate, setWinnerCandidate] =
    useState<ArenaComparisonCandidate | null>(null);
  const [winnerDialogOpen, setWinnerDialogOpen] = useState(false);
  const [winnerTrigger, setWinnerTrigger] = useState<HTMLElement | null>(null);
  const [winnerError, setWinnerError] = useState<string | null>(null);
  const [retryCandidateId, setRetryCandidateId] = useState<string | null>(null);
  const [candidateError, setCandidateError] = useState<{
    candidateId: string;
    message: string;
  } | null>(null);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [headerStatus, setHeaderStatus] = useState<string | null>(null);
  const [stopHadFailures, setStopHadFailures] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<
    'close' | 'dissolve' | null
  >(null);
  const lifecycleLockRef = useRef<'close' | 'dissolve' | null>(null);

  useEffect(() => {
    if (!comparison) return;
    setSelectedCandidateId((current) =>
      reconcileArenaCandidateSelection(current, comparison.candidates)
    );
  }, [comparison]);

  if (arenaQuery.error) {
    return (
      <div className="p-[var(--vk-space-4)] text-[length:var(--vk-font-size-sm)] text-[var(--vk-status-error)]">
        {t('arena.errors.loadFailed', {
          message:
            arenaQuery.error instanceof Error
              ? arenaQuery.error.message
              : String(arenaQuery.error),
        })}
      </div>
    );
  }

  if (arenaQuery.isLoading || !arenaQuery.data || !comparison) {
    return (
      <div className="p-[var(--vk-space-4)] text-[length:var(--vk-font-size-sm)] text-[var(--vk-text-low)]">
        {t('arena.workspace.loadingArena')}
      </div>
    );
  }

  const group = arenaQuery.data;
  const selectedCandidate =
    comparison.candidates.find(
      ({ candidateId }) => candidateId === selectedCandidateId
    ) ?? comparison.candidates[0];
  const minimumComparisonWidth =
    comparison.candidates.length * 320 +
    Math.max(0, comparison.candidates.length - 1) * 12;
  const useColumnGrid =
    comparison.candidates.length <= 3 &&
    comparisonWidth.width >= minimumComparisonWidth;
  const columnsClassName =
    comparison.candidates.length === 1
      ? 'grid-cols-1 max-w-3xl'
      : comparison.candidates.length === 2
        ? 'grid-cols-2'
        : 'grid-cols-3';
  const winnerSelectionPending =
    actions.promote.isPending || actions.startImplementation.isPending;
  const lifecyclePending =
    lifecycleAction !== null ||
    actions.close.isPending ||
    actions.dissolve.isPending;
  const candidateActionsDisabled =
    winnerDialogOpen ||
    winnerSelectionPending ||
    lifecyclePending ||
    actions.message.isPending ||
    actions.retry.isPending ||
    actions.stopAll.isPending;
  const attemptWorkspaces = group.workspaces.filter(
    ({ purpose }) => purpose === 'attempt'
  );
  const canSynthesize =
    group.lifecycle_status === 'open' &&
    !comparison.hasWinner &&
    comparison.activeCount === 0 &&
    attemptWorkspaces.length > 0;
  const winnerOutcome =
    group.mode === 'design' ? 'start-implementation' : 'adopt';

  const handleDissolved = () => {
    if (onDissolved) {
      onDissolved();
    } else if (typeof window !== 'undefined') {
      window.history.back();
    }
  };

  const handleSelectWinner = (
    candidate: ArenaComparisonCandidate,
    trigger: HTMLButtonElement
  ) => {
    if (candidateActionsDisabled || !candidate.canSelectWinner) return;
    setWinnerCandidate(candidate);
    setWinnerTrigger(trigger);
    setWinnerError(null);
    setWinnerDialogOpen(true);
  };

  const handleConfirmWinner = async () => {
    if (!winnerCandidate) return;
    const currentCandidate = comparison.candidates.find(
      ({ candidateId }) => candidateId === winnerCandidate.candidateId
    );
    if (!currentCandidate?.canSelectWinner) {
      setWinnerError(t('arena.errors.promoteFailed'));
      return;
    }
    setWinnerError(null);
    try {
      if (winnerOutcome === 'start-implementation') {
        await actions.startImplementation.mutateAsync({
          candidate_id: winnerCandidate.candidateId,
          follow_up_prompt: null,
          executor_config: null,
        });
      } else {
        await actions.promote.mutateAsync({
          candidateId: winnerCandidate.candidateId,
        });
      }
      setWinnerDialogOpen(false);
    } catch (error) {
      setWinnerError(
        error instanceof Error ? error.message : t('arena.errors.promoteFailed')
      );
    }
  };

  const handleRetry = async (candidate: ArenaComparisonCandidate) => {
    setCandidateError(null);
    if (!candidate.workspace.executor) {
      setCandidateError({
        candidateId: candidate.candidateId,
        message: t('arena.errors.retryUnknownExecutor'),
      });
      return;
    }

    const payload: RetryArenaRequest = {
      executor_config: executorConfigForWorkspace(candidate.workspace),
      name: candidate.workspace.name,
      prompt: null,
    };
    setRetryCandidateId(candidate.candidateId);
    try {
      await actions.retry.mutateAsync({
        workspaceId: candidate.workspaceId,
        payload,
      });
    } catch (error) {
      setCandidateError({
        candidateId: candidate.candidateId,
        message:
          error instanceof Error
            ? error.message
            : t('arena.errors.retryFailed'),
      });
    } finally {
      setRetryCandidateId(null);
    }
  };

  const handleSynthesize = async () => {
    if (!canSynthesize) return;
    setHeaderError(null);
    setHeaderStatus(null);
    try {
      const result = await SynthesizeArenaDialog.show({
        activityCount: group.events.length,
        attemptCount: comparison.attemptCount,
      });
      if (result.kind !== 'confirmed') return;
      await actions.message.mutateAsync({
        target: { type: 'synthesize', options: result.options },
        prompt: result.prompt,
        executor_config: executorConfigForWorkspace(attemptWorkspaces[0]),
      });
    } catch (error) {
      setHeaderError(
        error instanceof Error
          ? error.message
          : t('arena.errors.synthesizeFailed')
      );
    }
  };

  const handleStopAll = async () => {
    setHeaderError(null);
    setHeaderStatus(null);
    setStopHadFailures(false);
    try {
      const result = await actions.stopAll.mutateAsync({
        sessionIds: comparison.cancellableSessionIds,
      });
      if (result.failures.length > 0) {
        setStopHadFailures(true);
        setHeaderError(
          t('arena.stopAll.partialFailure', {
            failed: result.failures.length,
            total: Math.max(
              result.requestedAgentRunIds.length,
              result.failures.length
            ),
          })
        );
      } else {
        setHeaderStatus(
          t('arena.stopAll.requested', {
            count: result.cancelledAgentRunIds.length,
          })
        );
      }
    } catch (error) {
      setStopHadFailures(true);
      setHeaderError(
        error instanceof Error ? error.message : t('arena.stopAll.failed')
      );
    }
  };

  const handleClose = async () => {
    if (lifecycleLockRef.current || winnerDialogOpen || winnerSelectionPending)
      return;
    lifecycleLockRef.current = 'close';
    setLifecycleAction('close');
    setHeaderError(null);
    setHeaderStatus(null);
    try {
      await actions.close.mutateAsync();
      setHeaderStatus(t('arena.lifecycleActions.closedFeedback'));
    } catch (error) {
      setHeaderError(
        error instanceof Error ? error.message : t('arena.errors.closeFailed')
      );
    } finally {
      lifecycleLockRef.current = null;
      setLifecycleAction(null);
    }
  };

  const handleDissolve = async () => {
    if (lifecycleLockRef.current || winnerDialogOpen || winnerSelectionPending)
      return;
    lifecycleLockRef.current = 'dissolve';
    setLifecycleAction('dissolve');
    setHeaderError(null);
    try {
      const result = await ConfirmDialog.show({
        title: t('arena.lifecycleActions.dissolveTitle'),
        message: t('arena.lifecycleActions.dissolveMessage', {
          count: comparison.candidates.length,
        }),
        confirmText: t('arena.lifecycleActions.dissolveAndArchive'),
        cancelText: t('buttons.cancel'),
        variant: 'destructive',
      });
      if (result !== 'confirmed') return;
      await actions.dissolve.mutateAsync();
      handleDissolved();
    } catch (error) {
      setHeaderError(
        error instanceof Error
          ? error.message
          : t('arena.errors.dissolveFailed')
      );
    } finally {
      lifecycleLockRef.current = null;
      setLifecycleAction(null);
    }
  };

  const renderCandidate = (candidate: ArenaComparisonCandidate) => (
    <ArenaWorkspaceColumn
      key={candidate.candidateId}
      candidate={candidate}
      detailHref={buildWorkspaceHref?.(candidate.workspaceId)}
      actionError={
        candidateError?.candidateId === candidate.candidateId
          ? candidateError.message
          : null
      }
      retryPending={
        actions.retry.isPending && retryCandidateId === candidate.candidateId
      }
      winnerSelectionPending={candidateActionsDisabled}
      onRetry={(nextCandidate) => void handleRetry(nextCandidate)}
      onSelectWinner={handleSelectWinner}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--vk-surface-primary)]">
      <header className="border-b border-[var(--vk-border-subtle)] px-[var(--vk-space-4)] py-[var(--vk-space-3)]">
        <div className="flex flex-wrap items-center justify-between gap-[var(--vk-space-3)]">
          <div className="min-w-0">
            <h2 className="truncate text-[length:var(--vk-font-size-lg)] font-semibold text-[var(--vk-text-high)]">
              {t('arena.comparison.title', { prompt: group.prompt })}
            </h2>
            <p className="mt-[var(--vk-space-1)] text-[length:var(--vk-font-size-sm)] text-[var(--vk-text-low)]">
              {t('arena.comparison.summary', {
                count: comparison.candidates.length,
                completed: comparison.completedCount,
              })}
            </p>
          </div>

          <div className="flex items-center gap-[var(--vk-space-2)]">
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={
                !canSynthesize ||
                candidateActionsDisabled ||
                actions.message.isPending
              }
              loading={actions.message.isPending}
              loadingLabel={t('arena.actions.starting')}
              onClick={() => void handleSynthesize()}
            >
              <Sparkles aria-hidden="true" className="size-3.5" />
              {t('arena.actions.synthesize')}
            </Button>
            {comparison.cancellableSessionIds.length > 0 ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={candidateActionsDisabled}
                loading={actions.stopAll.isPending}
                loadingLabel={t('arena.stopAll.stopping')}
                onClick={() => void handleStopAll()}
              >
                <OctagonX aria-hidden="true" className="size-3.5" />
                {stopHadFailures
                  ? t('arena.stopAll.retry')
                  : t('arena.stopAll.action')}
              </Button>
            ) : null}
            {comparison.canClose || comparison.canDissolve ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant="icon"
                    aria-label={t('arena.moreActions')}
                    disabled={
                      lifecyclePending ||
                      winnerDialogOpen ||
                      winnerSelectionPending ||
                      actions.message.isPending ||
                      actions.retry.isPending ||
                      actions.stopAll.isPending
                    }
                  >
                    <MoreHorizontal aria-hidden="true" className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {comparison.canClose ? (
                    <DropdownMenuItem onSelect={() => void handleClose()}>
                      {t('arena.lifecycleActions.closeRound')}
                    </DropdownMenuItem>
                  ) : null}
                  {comparison.canClose && comparison.canDissolve ? (
                    <DropdownMenuSeparator />
                  ) : null}
                  {comparison.canDissolve ? (
                    <DropdownMenuItem
                      variant="danger"
                      onSelect={() => void handleDissolve()}
                    >
                      {t('arena.lifecycleActions.dissolveAndArchive')}
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
        {headerError ? (
          <p
            className="mt-[var(--vk-space-2)] text-[length:var(--vk-font-size-sm)] text-[var(--vk-status-error)]"
            role="alert"
          >
            {headerError}
          </p>
        ) : null}
        {headerStatus ? (
          <p
            className="mt-[var(--vk-space-2)] text-[length:var(--vk-font-size-sm)] text-[var(--vk-text-low)]"
            role="status"
          >
            {headerStatus}
          </p>
        ) : null}
      </header>

      <main
        ref={comparisonWidth.setElement}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-[var(--vk-space-4)]"
      >
        {comparison.candidates.length === 0 ? (
          <div className="rounded-[var(--vk-radius-md)] border border-dashed border-[var(--vk-border-subtle)] p-[var(--vk-space-6)] text-center text-[length:var(--vk-font-size-sm)] text-[var(--vk-text-low)]">
            {t('arena.comparison.empty')}
          </div>
        ) : useColumnGrid ? (
          <div
            className={cn(
              'mx-auto grid gap-[var(--vk-space-3)]',
              columnsClassName
            )}
          >
            {comparison.candidates.map(renderCandidate)}
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-[var(--vk-space-3)]">
            <div className="sticky top-0 z-10 rounded-[var(--vk-radius-md)] border border-[var(--vk-border-subtle)] bg-[var(--vk-surface-primary)] p-[var(--vk-space-3)] shadow-[var(--vk-elevation-1)]">
              <label
                className="text-[length:var(--vk-font-size-sm)] font-medium text-[var(--vk-text-high)]"
                htmlFor="arena-candidate-selector"
              >
                {t('arena.selector.label')}
              </label>
              <Select
                value={selectedCandidate?.candidateId}
                onValueChange={setSelectedCandidateId}
              >
                <SelectTrigger
                  id="arena-candidate-selector"
                  className="mt-[var(--vk-space-2)] rounded-[var(--vk-radius-md)] bg-[var(--vk-surface-secondary)]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {comparison.candidates.map((candidate) => (
                    <SelectItem
                      key={candidate.candidateId}
                      value={candidate.candidateId}
                    >
                      {candidate.label} ·{' '}
                      {t(`arena.purpose.${candidate.purpose}`)} ·{' '}
                      {t(
                        `arena.agentStatus.${candidate.agentRunStatus ?? 'not_started'}`
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-[var(--vk-space-2)] text-[length:var(--vk-font-size-sm)] text-[var(--vk-text-low)]">
                {t('arena.selector.fixedSummary', {
                  attempts: comparison.attemptCount,
                  synthesis: comparison.synthesisCount,
                  active: comparison.activeCount,
                })}
              </p>
            </div>
            {selectedCandidate ? renderCandidate(selectedCandidate) : null}
          </div>
        )}
      </main>

      <ArenaWinnerConfirmDialog
        candidate={winnerCandidate}
        archiveSiblingCount={
          winnerOutcome === 'adopt'
            ? Math.max(0, comparison.candidates.length - 1)
            : null
        }
        outcome={winnerOutcome}
        open={winnerDialogOpen}
        isPending={winnerSelectionPending}
        error={winnerError}
        returnFocusTarget={winnerTrigger}
        onOpenChange={(open) => {
          setWinnerDialogOpen(open);
          if (!open) setWinnerError(null);
        }}
        onConfirm={handleConfirmWinner}
      />
    </div>
  );
}
