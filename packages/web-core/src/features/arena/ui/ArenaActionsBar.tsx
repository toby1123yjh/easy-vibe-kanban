import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@vibe/ui/components/Button';
import type { BaseCodingAgent } from 'shared/types';
import { ConfirmDialog } from '@/shared/dialogs/shared/ConfirmDialog';
import { useArenaActions } from '@/shared/hooks/useArenaActions';
import type {
  ArenaGroupResponse,
  ArenaWorkspaceSummary,
  RetryArenaRequest,
} from '@/shared/lib/arenaApi';

interface ArenaActionsBarProps {
  group: ArenaGroupResponse;
  workspace: ArenaWorkspaceSummary;
}

/**
 * The action row at the bottom of an arena column. Three buttons map
 * 1:1 to the backend mutations declared in `useArenaActions`:
 *
 *   [Promote]  — `POST /arena/{group_id}/promote`
 *   [Retry]    — `POST /arena/{group_id}/workspaces/{wid}/retry`
 *                (re-uses the same executor_config; users who want to
 *                switch agents go through the create-mode form in
 *                Step 4)
 *   [Reject]   — soft variant of Retry: just archive this attempt,
 *                no respawn. Implemented as `dissolve` of a
 *                singleton-group equivalent — which we don't yet
 *                support — so for now we expose it only when the
 *                group still has other live attempts. Behaviorally
 *                identical to "click Retry then immediately abandon
 *                the new attempt" so it's deferred to Step 4.
 *
 * Promote shows a destructive confirm dialog (per spec.md §5.3). The
 * other actions fire immediately — Retry is reversible (the new
 * attempt is just another sibling) and dissolve is itself a confirm
 * action surfaced separately at the group level (not per-workspace).
 */
export function ArenaActionsBar({ group, workspace }: ArenaActionsBarProps) {
  const { t } = useTranslation('common');
  const { promote, retry } = useArenaActions(group.id, null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (group.mode === 'design') {
    return null;
  }

  const groupAlreadyPromoted = group.winner_candidate_id != null;
  const myStatus = workspace.arena_status;
  const liveSiblings = group.workspaces.filter(
    (w) =>
      w.workspace_id !== workspace.workspace_id && w.arena_status === 'active'
  ).length;

  const isThisPending = promote.isPending || retry.isPending;
  const disabledForState =
    groupAlreadyPromoted || myStatus !== 'active' || isThisPending;

  const handlePromote = async () => {
    setErrorMessage(null);
    const result = await ConfirmDialog.show({
      title: t('arena.confirm.promoteTitle'),
      message:
        liveSiblings > 0
          ? t('arena.confirm.promoteMessageWithSiblings', {
              count: liveSiblings,
            })
          : t('arena.confirm.promoteMessageSingle'),
      confirmText: t('arena.actions.promote'),
      cancelText: t('buttons.cancel'),
      variant: 'destructive',
    });
    if (result !== 'confirmed') return;

    try {
      await promote.mutateAsync({ candidateId: workspace.candidate_id });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : t('arena.errors.promoteFailed')
      );
    }
  };

  const handleRetry = async () => {
    setErrorMessage(null);
    if (!workspace.executor) {
      setErrorMessage(t('arena.errors.retryUnknownExecutor'));
      return;
    }

    // Mirror the original config. The full create-mode form (with the
    // ability to swap models / variants) lands in Step 4.
    const payload: RetryArenaRequest = {
      executor_config: {
        executor: workspace.executor as BaseCodingAgent,
        variant: workspace.variant ?? null,
        model_id: null,
        agent_id: null,
        reasoning_id: null,
        permission_policy: null,
      },
      name: workspace.name,
      // Per-attempt prompt override is left undefined → handler falls
      // back to the group's shared prompt.
      prompt: null,
    };

    try {
      await retry.mutateAsync({
        workspaceId: workspace.workspace_id,
        payload,
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : t('arena.errors.retryFailed')
      );
    }
  };

  return (
    <div className="border-t border-zinc-200 p-half dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-half">
        <Button
          size="xs"
          variant="default"
          disabled={disabledForState}
          onClick={() => void handlePromote()}
          aria-label={t('arena.aria.promoteAttempt')}
        >
          {promote.isPending
            ? t('arena.actions.promoting')
            : t('arena.actions.promote')}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabledForState}
          onClick={() => void handleRetry()}
          aria-label={t('arena.aria.retryAttempt')}
        >
          {retry.isPending
            ? t('arena.actions.retrying')
            : t('arena.actions.retry')}
        </Button>
      </div>
      {errorMessage ? (
        <p className="mt-half text-xs text-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
