import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, OctagonX, Sparkles } from 'lucide-react';
import { BaseCodingAgent, type ExecutorConfig } from 'shared/types';
import { Button } from '@vibe/ui/components/Button';
import {
  DegradedState,
  EmptyState,
  ErrorState,
  LoadingState,
} from '@vibe/ui/components/StateSurface';
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
import { arenaQueryKeys, useArenaGroup } from '@/shared/hooks/useArenaGroup';
import type {
  ArenaGroupResponse,
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
  const queryClient = useQueryClient();
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
  const [arenaRetryPending, setArenaRetryPending] = useState(false);
  const arenaRetryLockRef = useRef(false);
  const candidateRetryLockRef = useRef(false);
  const stopAllLockRef = useRef(false);
  const synthesizeLockRef = useRef(false);
  const lifecycleLockRef = useRef<'close' | 'dissolve' | null>(null);

  useEffect(() => {
    if (!comparison) return;
    setSelectedCandidateId((current) =>
      reconcileArenaCandidateSelection(current, comparison.candidates)
    );
  }, [comparison]);

  if (arenaQuery.isPending && !arenaQuery.data) {
    return (
      <LoadingState
        className="h-full w-full bg-[var(--vk-surface-primary)]"
        title={t('arena.workspace.loadingArena')}
      />
    );
  }

  const arenaErrorMessage =
    arenaQuery.error instanceof Error
      ? arenaQuery.error.message
      : arenaQuery.error
        ? String(arenaQuery.error)
        : t('errors.generic');
  const getArenaLoadFailure = (currentError: unknown) => {
    if (!currentError) return null;
    return t('arena.errors.loadFailed', {
      message:
        currentError instanceof Error
          ? currentError.message
          : String(currentError),
    });
  };
  const getCurrentArenaSnapshot = () => {
    const state = queryClient.getQueryState<ArenaGroupResponse>(
      arenaQueryKeys.group(groupId)
    );
    const currentGroup = state?.data ?? null;
    return {
      error: state?.error ?? null,
      group: currentGroup,
      comparison: currentGroup
        ? buildArenaComparisonView(currentGroup, {
            attempt: (order) =>
              t('arena.workspace.attemptName', { index: order }),
            synthesis: (order) => `${t('arena.purpose.synthesis')} ${order}`,
          })
        : null,
    };
  };
  const handleArenaRetry = async () => {
    if (arenaRetryLockRef.current || arenaQuery.isFetching) return;
    arenaRetryLockRef.current = true;
    setArenaRetryPending(true);
    try {
      await arenaQuery.refetch();
    } finally {
      arenaRetryLockRef.current = false;
      setArenaRetryPending(false);
    }
  };
  const retryArenaAction = (
    <Button
      type="button"
      variant="outline"
      className="min-h-11"
      loading={arenaRetryPending || arenaQuery.isFetching}
      loadingLabel={t('arena.actions.retrying')}
      onClick={() => void handleArenaRetry()}
    >
      {t('buttons.retry')}
    </Button>
  );

  if (!arenaQuery.data || !comparison) {
    return (
      <ErrorState
        className="h-full w-full bg-[var(--vk-surface-primary)]"
        title={t('arena.errors.loadFailed', {
          message: arenaErrorMessage,
        })}
        action={retryArenaAction}
      />
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
    Boolean(arenaQuery.error) ||
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
    const snapshot = getCurrentArenaSnapshot();
    const loadFailure = getArenaLoadFailure(snapshot.error);
    if (loadFailure) {
      setWinnerError(loadFailure);
      return;
    }
    const currentCandidate = snapshot.comparison?.candidates.find(
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
    if (candidateRetryLockRef.current) return;
    candidateRetryLockRef.current = true;
    setCandidateError(null);
    const snapshot = getCurrentArenaSnapshot();
    const loadFailure = getArenaLoadFailure(snapshot.error);
    if (loadFailure) {
      setCandidateError({
        candidateId: candidate.candidateId,
        message: loadFailure,
      });
      candidateRetryLockRef.current = false;
      return;
    }
    const currentCandidate = snapshot.comparison?.candidates.find(
      ({ candidateId }) => candidateId === candidate.candidateId
    );
    if (!currentCandidate?.canRetry) {
      setCandidateError({
        candidateId: candidate.candidateId,
        message: t('arena.errors.retryFailed'),
      });
      candidateRetryLockRef.current = false;
      return;
    }
    if (!currentCandidate.workspace.executor) {
      setCandidateError({
        candidateId: candidate.candidateId,
        message: t('arena.errors.retryUnknownExecutor'),
      });
      candidateRetryLockRef.current = false;
      return;
    }

    const payload: RetryArenaRequest = {
      executor_config: executorConfigForWorkspace(currentCandidate.workspace),
      name: currentCandidate.workspace.name,
      prompt: null,
    };
    setRetryCandidateId(candidate.candidateId);
    try {
      await actions.retry.mutateAsync({
        workspaceId: currentCandidate.workspaceId,
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
      candidateRetryLockRef.current = false;
    }
  };

  const handleSynthesize = async () => {
    if (synthesizeLockRef.current) return;
    const openingSnapshot = getCurrentArenaSnapshot();
    const openingAttempts =
      openingSnapshot.group?.workspaces.filter(
        ({ purpose }) => purpose === 'attempt'
      ) ?? [];
    const openingCanSynthesize =
      openingSnapshot.group?.lifecycle_status === 'open' &&
      !openingSnapshot.comparison?.hasWinner &&
      openingSnapshot.comparison?.activeCount === 0 &&
      openingAttempts.length > 0;
    if (!openingCanSynthesize || getArenaLoadFailure(openingSnapshot.error))
      return;
    synthesizeLockRef.current = true;
    setHeaderError(null);
    setHeaderStatus(null);
    try {
      const result = await SynthesizeArenaDialog.show({
        activityCount: openingSnapshot.group?.events.length ?? 0,
        attemptCount: openingSnapshot.comparison?.attemptCount ?? 0,
      });
      if (result.kind !== 'confirmed') return;
      const currentSnapshot = getCurrentArenaSnapshot();
      const loadFailure = getArenaLoadFailure(currentSnapshot.error);
      if (loadFailure) {
        setHeaderError(loadFailure);
        return;
      }
      const currentAttempts =
        currentSnapshot.group?.workspaces.filter(
          ({ purpose }) => purpose === 'attempt'
        ) ?? [];
      const currentCanSynthesize =
        currentSnapshot.group?.lifecycle_status === 'open' &&
        !currentSnapshot.comparison?.hasWinner &&
        currentSnapshot.comparison?.activeCount === 0 &&
        currentAttempts.length > 0;
      if (!currentCanSynthesize) {
        setHeaderError(t('arena.errors.synthesizeFailed'));
        return;
      }
      await actions.message.mutateAsync({
        target: { type: 'synthesize', options: result.options },
        prompt: result.prompt,
        executor_config: executorConfigForWorkspace(currentAttempts[0]),
      });
    } catch (error) {
      setHeaderError(
        error instanceof Error
          ? error.message
          : t('arena.errors.synthesizeFailed')
      );
    } finally {
      synthesizeLockRef.current = false;
    }
  };

  const handleStopAll = async () => {
    if (stopAllLockRef.current) return;
    stopAllLockRef.current = true;
    const snapshot = getCurrentArenaSnapshot();
    const loadFailure = getArenaLoadFailure(snapshot.error);
    if (loadFailure) {
      setHeaderError(loadFailure);
      stopAllLockRef.current = false;
      return;
    }
    setHeaderError(null);
    setHeaderStatus(null);
    setStopHadFailures(false);
    try {
      const cancellableSessionIds =
        snapshot.comparison?.cancellableSessionIds ?? [];
      if (cancellableSessionIds.length === 0) {
        setHeaderStatus(t('arena.stopAll.requested', { count: 0 }));
        return;
      }
      const result = await actions.stopAll.mutateAsync({
        sessionIds: cancellableSessionIds,
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
    } finally {
      stopAllLockRef.current = false;
    }
  };

  const handleClose = async () => {
    if (lifecycleLockRef.current || winnerDialogOpen || winnerSelectionPending)
      return;
    const currentSnapshot = getCurrentArenaSnapshot();
    const loadFailure = getArenaLoadFailure(currentSnapshot.error);
    if (loadFailure) {
      setHeaderError(loadFailure);
      return;
    }
    if (!currentSnapshot.comparison?.canClose) {
      setHeaderError(t('arena.errors.closeFailed'));
      return;
    }
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
    const openingSnapshot = getCurrentArenaSnapshot();
    const openingLoadFailure = getArenaLoadFailure(openingSnapshot.error);
    if (openingLoadFailure) {
      setHeaderError(openingLoadFailure);
      return;
    }
    if (!openingSnapshot.comparison?.canDissolve) {
      setHeaderError(t('arena.errors.dissolveFailed'));
      return;
    }
    lifecycleLockRef.current = 'dissolve';
    setLifecycleAction('dissolve');
    setHeaderError(null);
    try {
      const result = await ConfirmDialog.show({
        title: t('arena.lifecycleActions.dissolveTitle'),
        message: t('arena.lifecycleActions.dissolveMessage', {
          count: openingSnapshot.comparison.candidates.length,
        }),
        confirmText: t('arena.lifecycleActions.dissolveAndArchive'),
        cancelText: t('buttons.cancel'),
        variant: 'destructive',
      });
      if (result !== 'confirmed') return;
      const currentSnapshot = getCurrentArenaSnapshot();
      const loadFailure = getArenaLoadFailure(currentSnapshot.error);
      if (loadFailure) {
        setHeaderError(loadFailure);
        return;
      }
      if (!currentSnapshot.comparison?.canDissolve) {
        setHeaderError(t('arena.errors.dissolveFailed'));
        return;
      }
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
                    disabled={candidateActionsDisabled}
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

      {arenaQuery.error ? (
        <DegradedState
          compact
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="mx-[var(--vk-space-4)] mt-[var(--vk-space-3)] border border-[var(--vk-status-waiting)]"
          title={t('arena.errors.loadFailed', {
            message: arenaErrorMessage,
          })}
          action={retryArenaAction}
        />
      ) : null}

      <div
        ref={comparisonWidth.setElement}
        role="region"
        aria-label={t('arena.title')}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-[var(--vk-space-4)]"
      >
        {comparison.candidates.length === 0 ? (
          <EmptyState
            className="min-h-64 rounded-[var(--vk-radius-md)] border border-dashed border-[var(--vk-border-subtle)]"
            title={t('arena.comparison.empty')}
          />
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
      </div>

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
