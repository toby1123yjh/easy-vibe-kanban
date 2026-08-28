import { useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Button } from '@vibe/ui/components/Button';
import { useArenaGroup } from '@/shared/hooks/useArenaGroup';
import { useArenaActions } from '@/shared/hooks/useArenaActions';
import { ConfirmDialog } from '@/shared/dialogs/shared/ConfirmDialog';
import {
  isActiveArenaAgentRunStatus,
  type ArenaEvent,
  type ArenaGroupResponse,
  type ArenaWorkspaceSummary,
} from '@/shared/lib/arenaApi';
import { ArenaConversationPane } from './ArenaConversationPane';
import { ArenaModeBadge } from './ArenaModeBadge';
import { ArenaPageActions } from './ArenaPageActions';
import { ArenaWorkspaceColumn } from './ArenaWorkspaceColumn';

interface ArenaViewProps {
  groupId: string;
  /**
   * Build the URL for "open this workspace's detail page" (column
   * header link). Returning `undefined` hides the link. The host app
   * supplies this so we don't take a hard dependency on a specific
   * route shape.
   */
  buildWorkspaceHref?: (workspaceId: string) => string | undefined;
  /**
   * Where to redirect after the user dissolves the group (the page
   * itself ceases to exist). Typically the project's kanban page.
   */
  onDissolved?: () => void;
}

function ArenaHeader({
  group,
  onDissolved,
}: {
  group: ArenaGroupResponse;
  onDissolved?: () => void;
}) {
  const { t } = useTranslation('common');
  const attemptTotal = group.workspaces.filter(
    (ws) => ws.purpose === 'attempt'
  ).length;
  const synthesisTotal = group.workspaces.filter(
    (ws) => ws.purpose === 'synthesis'
  ).length;
  const promoted = group.workspaces.filter(
    (ws) => ws.arena_status === 'promoted'
  ).length;
  const archived = group.workspaces.filter(
    (ws) => ws.arena_status === 'archived'
  ).length;
  const running = group.workspaces.filter((ws) =>
    isActiveArenaAgentRunStatus(ws.latest_agent_run_status)
  ).length;

  const { dissolve, close } = useArenaActions(group.id, null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const groupAlreadyPromoted = group.winner_candidate_id != null;
  const canCloseDesign =
    group.mode === 'design' && group.lifecycle_status === 'open';
  const canDissolveImplementation =
    group.mode === 'implementation' && !groupAlreadyPromoted;

  const handleClose = async () => {
    setErrorMessage(null);
    try {
      await close.mutateAsync();
      onDissolved?.();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : t('arena.errors.closeFailed')
      );
    }
  };

  const handleDissolve = async () => {
    setErrorMessage(null);
    const result = await ConfirmDialog.show({
      title: t('arena.confirm.dissolveTitle'),
      message: t('arena.confirm.dissolveMessage', { count: attemptTotal }),
      confirmText: t('arena.actions.dissolve'),
      cancelText: t('buttons.cancel'),
      variant: 'destructive',
    });
    if (result !== 'confirmed') return;

    try {
      await dissolve.mutateAsync();
      onDissolved?.();
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : t('arena.errors.dissolveFailed')
      );
    }
  };

  return (
    <div className="border-b border-zinc-200 px-base py-half dark:border-zinc-800">
      <div className="flex items-start justify-between gap-base">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-medium">
            {t('arena.headerTitle', { count: attemptTotal })}
          </h2>
          <div className="mt-half">
            <ArenaModeBadge group={group} />
          </div>
          <p className="mt-1 line-clamp-2 max-w-2xl text-xs text-low">
            {group.prompt}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-half">
          <div className="text-xs text-low">
            {t(
              synthesisTotal > 0
                ? 'arena.headerSummaryWithMemos'
                : 'arena.headerSummary',
              {
                running,
                promoted,
                archived,
                memos: synthesisTotal,
              }
            )}
          </div>
          {canCloseDesign ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => void handleClose()}
              disabled={close.isPending}
              aria-label={t('arena.aria.closeGroup')}
            >
              {close.isPending
                ? t('arena.actions.closing')
                : t('arena.actions.close')}
            </Button>
          ) : null}
          {canDissolveImplementation ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => void handleDissolve()}
              disabled={dissolve.isPending}
              aria-label={t('arena.aria.dissolveGroup')}
            >
              {dissolve.isPending
                ? t('arena.actions.dissolving')
                : t('arena.actions.dissolve')}
            </Button>
          ) : null}
        </div>
      </div>
      {errorMessage ? (
        <p className="mt-half text-xs text-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

function workspaceName(
  workspaces: ArenaWorkspaceSummary[],
  workspaceId: string | null,
  t: TFunction
) {
  if (!workspaceId) return t('arena.title');
  const index = workspaces.findIndex(
    (workspace) => workspace.workspace_id === workspaceId
  );
  if (index === -1) return t('arena.title');
  return (
    workspaces[index].name ||
    workspaces[index].executor ||
    t('arena.workspace.attemptName', { index: index + 1 })
  );
}

function eventTitle(
  event: ArenaEvent,
  workspaces: ArenaWorkspaceSummary[],
  t: TFunction
) {
  switch (event.kind) {
    case 'ask_all':
      return t('arena.activity.askAll');
    case 'workspace':
      return t('arena.activity.messageTo', {
        workspace: workspaceName(workspaces, event.target_workspace_id, t),
      });
    case 'challenge':
      return t('arena.activity.challenge', {
        target: workspaceName(workspaces, event.target_workspace_id, t),
        source: workspaceName(workspaces, event.source_workspace_id, t),
      });
    case 'synthesize':
      return t('arena.activity.synthesize');
    case 'start_implementation':
      return t('arena.activity.startImplementation', {
        workspace: workspaceName(workspaces, event.target_workspace_id, t),
      });
    default:
      return t('arena.activity.default');
  }
}

function ArenaActivity({ group }: { group: ArenaGroupResponse }) {
  const { t } = useTranslation('common');
  if (group.events.length === 0) return null;

  const events = group.events.slice(-6).reverse();

  return (
    <div className="border-b border-zinc-200 bg-primary px-base py-half dark:border-zinc-800">
      <div className="mb-half text-xs font-medium text-low">
        {t('arena.activity.title')}
      </div>
      <div className="flex flex-wrap gap-half">
        {events.map((event) => (
          <div
            key={event.id}
            className="max-w-[320px] rounded border border-zinc-200 bg-secondary px-half py-1 text-xs dark:border-zinc-800"
          >
            <div className="font-medium text-normal">
              {eventTitle(event, group.workspaces, t)}
            </div>
            <div className="truncate text-low">
              {event.prompt || t('arena.activity.noPrompt')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Multi-column diff + actions view for an arena race.
 *
 * Step 2 added the read-only layout. Step 3 (this revision) adds the
 * promote / retry / dissolve mutations:
 *   - Per-column [Promote] / [Retry] in {@link ArenaActionsBar}
 *   - Group-level [Dissolve] in the header (above)
 */
export function ArenaView({
  groupId,
  buildWorkspaceHref,
  onDissolved,
}: ArenaViewProps) {
  const { t } = useTranslation('common');
  const { data, isLoading, error } = useArenaGroup(groupId);

  const handleDissolved = () => {
    if (onDissolved) {
      onDissolved();
    } else if (typeof window !== 'undefined') {
      window.history.back();
    }
  };

  if (error) {
    return (
      <div className="p-base text-sm text-error">
        {t('arena.errors.loadFailed', { message: (error as Error).message })}
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="p-base text-sm text-low">
        {t('arena.workspace.loadingArena')}
      </div>
    );
  }

  const isDesignArena = data.mode === 'design';
  const attemptWorkspaces = data.workspaces.filter(
    (workspace) => workspace.purpose === 'attempt'
  );
  const synthesisWorkspaces = data.workspaces.filter(
    (workspace) => workspace.purpose === 'synthesis'
  );
  const columnsClassName =
    data.workspaces.length === 1
      ? 'grid-cols-1'
      : data.workspaces.length === 2
        ? 'grid-cols-1 md:grid-cols-2'
        : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';

  return (
    <div className="flex h-full flex-col">
      <ArenaHeader group={data} onDissolved={handleDissolved} />

      {isDesignArena ? <ArenaPageActions group={data} /> : null}

      {isDesignArena ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <ArenaActivity group={data} />
          <div className="flex min-h-0 flex-1 gap-base overflow-x-auto p-base">
            {attemptWorkspaces.map((ws) => (
              <ArenaConversationPane
                key={ws.workspace_id}
                group={data}
                workspace={ws}
                detailHref={buildWorkspaceHref?.(ws.workspace_id)}
              />
            ))}
          </div>
          {synthesisWorkspaces.length > 0 ? (
            <div className="max-h-[42%] min-h-[280px] border-t border-zinc-200 bg-secondary dark:border-zinc-800">
              <div className="px-base pt-half text-xs font-medium text-low">
                {t('arena.synthesis.decisionMemo')}
              </div>
              <div className="flex h-[calc(100%-1.75rem)] gap-base overflow-x-auto p-base pt-half">
                {synthesisWorkspaces.map((ws) => (
                  <ArenaConversationPane
                    key={ws.workspace_id}
                    group={data}
                    workspace={ws}
                    detailHref={buildWorkspaceHref?.(ws.workspace_id)}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div
          className={`grid flex-1 gap-base overflow-auto p-base ${columnsClassName}`}
        >
          {data.workspaces.map((ws) => (
            <ArenaWorkspaceColumn
              key={ws.workspace_id}
              group={data}
              workspace={ws}
              detailHref={buildWorkspaceHref?.(ws.workspace_id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
