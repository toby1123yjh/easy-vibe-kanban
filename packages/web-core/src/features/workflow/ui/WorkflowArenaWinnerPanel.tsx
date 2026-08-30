import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle,
  CheckCircle,
  ExternalLink,
  GitBranch,
  Loader2,
  Swords,
} from 'lucide-react';
import { Button } from '@vibe/ui/components/Button';
import {
  useArenaGroup,
  useArenaInvalidators,
} from '@/shared/hooks/useArenaGroup';
import { useWorkflowRunMutations } from '@/shared/hooks/useWorkflowRun';
import { buildWorkspaceSessionHref } from '@/shared/lib/routes/workspaceRoutes';
import { cn } from '@/shared/lib/utils';
import { ArenaWinnerConfirmDialog } from '@/shared/dialogs/arena/ArenaWinnerConfirmDialog';
import {
  buildArenaComparisonView,
  type ArenaComparisonCandidate,
} from '../../arena/model/arenaComparisonView';

export interface WorkflowArenaWinnerPanelProps {
  arenaGroupId: string | null;
  className?: string;
  issueId: string;
  nodeId: string;
  projectId: string;
  runId: string;
}

export function WorkflowArenaWinnerPanel({
  arenaGroupId,
  className,
  issueId,
  nodeId,
  projectId,
  runId,
}: WorkflowArenaWinnerPanelProps) {
  const { t } = useTranslation('common');
  const { selectArenaWinner, isSelectingArenaWinner } =
    useWorkflowRunMutations();
  const { invalidateGroup } = useArenaInvalidators();
  const [confirmationCandidate, setConfirmationCandidate] =
    useState<ArenaComparisonCandidate | null>(null);
  const [winnerDialogOpen, setWinnerDialogOpen] = useState(false);
  const [winnerTrigger, setWinnerTrigger] = useState<HTMLElement | null>(null);
  const [confirmationError, setConfirmationError] = useState<string | null>(
    null
  );
  const {
    data: arenaGroup,
    error: arenaError,
    isLoading,
  } = useArenaGroup(arenaGroupId, {
    enabled: !!arenaGroupId,
  });

  const comparison = useMemo(
    () =>
      arenaGroup
        ? buildArenaComparisonView(arenaGroup, {
            attempt: (order) =>
              t('arena.workspace.attemptName', { index: order }),
            synthesis: (order) => `${t('arena.purpose.synthesis')} ${order}`,
          })
        : null,
    [arenaGroup, t]
  );
  const candidates = comparison?.candidates ?? [];

  const arenaHref = arenaGroupId
    ? `/projects/${projectId}/issues/${issueId}/arena/${arenaGroupId}`
    : null;

  const handleConfirmWinner = async () => {
    if (!confirmationCandidate) return;
    const currentCandidate = comparison?.candidates.find(
      ({ candidateId }) => candidateId === confirmationCandidate.candidateId
    );
    if (!currentCandidate?.canSelectWinner) {
      setConfirmationError(t('workflow.arenaWinner.selectFailed'));
      return;
    }
    setConfirmationError(null);
    try {
      await selectArenaWinner({
        runId,
        nodeId,
        payload: { candidate_id: currentCandidate.candidateId },
      });
      if (arenaGroupId) {
        invalidateGroup(arenaGroupId);
      }
      setWinnerDialogOpen(false);
    } catch (err) {
      setConfirmationError(
        err instanceof Error
          ? err.message
          : t('workflow.arenaWinner.selectFailed')
      );
    }
  };

  return (
    <div
      className={cn(
        'space-y-half rounded border border-warning/50 bg-warning/10 p-half',
        className
      )}
    >
      <div className="flex items-start justify-between gap-half">
        <div className="min-w-0">
          <h4 className="flex items-center gap-half text-sm font-semibold text-warning">
            <Swords className="h-4 w-4" />
            {t('workflow.arenaWinner.title')}
          </h4>
          <p className="mt-1 text-xs text-high">
            {t('workflow.arenaWinner.description')}
          </p>
        </div>
        {arenaHref ? (
          <a
            className="inline-flex min-h-8 shrink-0 items-center gap-half rounded border border-secondary bg-panel px-half py-1 text-xs font-medium text-brand hover:bg-secondary"
            href={arenaHref}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Arena
          </a>
        ) : null}
      </div>

      {!arenaGroupId ? (
        <p className="text-xs text-low">
          {t('workflow.arenaWinner.noGroupLink')}
        </p>
      ) : isLoading ? (
        <div className="flex items-center gap-half text-xs text-low">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('workflow.arenaWinner.loadingAttempts')}
        </div>
      ) : arenaError ? (
        <p className="text-xs text-error" role="alert">
          {t('workflow.arenaWinner.loadFailed', {
            message:
              arenaError instanceof Error
                ? arenaError.message
                : t('workflow.arenaWinner.unknownError'),
          })}
        </p>
      ) : candidates.length === 0 ? (
        <p className="text-xs text-low">
          {t('workflow.arenaWinner.noAttempts')}
        </p>
      ) : (
        <div className="space-y-half">
          {candidates.map((candidate) => {
            const workspaceBaseHref = `/projects/${projectId}/issues/${issueId}/workspaces/${candidate.workspaceId}`;
            const workspaceHref =
              buildWorkspaceSessionHref(
                workspaceBaseHref,
                candidate.sessionId
              ) ?? workspaceBaseHref;
            const isApplying =
              isSelectingArenaWinner &&
              confirmationCandidate?.candidateId === candidate.candidateId;

            return (
              <div
                key={candidate.candidateId}
                className={cn(
                  'rounded border bg-panel p-half text-xs',
                  candidate.isWinner ? 'border-success/60' : 'border-secondary'
                )}
              >
                <div className="flex items-start justify-between gap-half">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-half">
                      {candidate.isWinner ? (
                        <CheckCircle className="h-3.5 w-3.5 text-success" />
                      ) : candidate.canSelectWinner ? (
                        <Swords className="h-3.5 w-3.5 text-warning" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 text-low" />
                      )}
                      <span className="truncate font-medium text-high">
                        {candidate.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-half gap-y-1 text-low">
                      <span>
                        {candidate.executorLabel ||
                          t('workflow.arenaWinner.unknownExecutor')}
                      </span>
                      <span>
                        {t(
                          `arena.agentStatus.${candidate.agentRunStatus ?? 'not_started'}`
                        )}
                      </span>
                      <span>{t(`arena.status.${candidate.arenaStatus}`)}</span>
                      <span>
                        {candidate.workspace.has_uncommitted_changes === true
                          ? t('workflow.arenaWinner.changes')
                          : candidate.workspace.has_uncommitted_changes ===
                              false
                            ? t('workflow.arenaWinner.noChanges')
                            : t('workflow.arenaWinner.changesUnknown')}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-center gap-half text-low">
                      <GitBranch className="h-3 w-3 shrink-0" />
                      <span className="truncate font-mono">
                        {candidate.branch}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-half">
                    <a
                      className="inline-flex min-h-8 items-center rounded border border-secondary px-half py-1 text-xs font-medium text-brand hover:bg-secondary"
                      href={workspaceHref}
                      aria-label={t('workflow.arenaWinner.openWorkspace', {
                        label: candidate.label,
                      })}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <Button
                      type="button"
                      size="xs"
                      disabled={
                        !candidate.canSelectWinner || isSelectingArenaWinner
                      }
                      onClick={(event) => {
                        setConfirmationCandidate(candidate);
                        setWinnerTrigger(event.currentTarget);
                        setConfirmationError(null);
                        setWinnerDialogOpen(true);
                      }}
                    >
                      {candidate.isWinner
                        ? t('workflow.arenaWinner.selected')
                        : isApplying
                          ? t('workflow.arenaWinner.applying')
                          : t('workflow.arenaWinner.selectWinner')}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ArenaWinnerConfirmDialog
        candidate={confirmationCandidate}
        archiveSiblingCount={Math.max(0, candidates.length - 1)}
        outcome="workflow"
        open={winnerDialogOpen}
        isPending={isSelectingArenaWinner}
        error={confirmationError}
        returnFocusTarget={winnerTrigger}
        onOpenChange={(open) => {
          setWinnerDialogOpen(open);
          if (!open) setConfirmationError(null);
        }}
        onConfirm={handleConfirmWinner}
      />
    </div>
  );
}
