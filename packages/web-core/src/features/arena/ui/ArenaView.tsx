import { useState } from 'react';
import { Button } from '@vibe/ui/components/Button';
import { useArenaGroup } from '@/shared/hooks/useArenaGroup';
import { useArenaActions } from '@/shared/hooks/useArenaActions';
import { ConfirmDialog } from '@/shared/dialogs/shared/ConfirmDialog';
import type { ArenaGroupResponse } from '@/shared/lib/arenaApi';
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
  const total = group.workspaces.length;
  const promoted = group.workspaces.filter(
    (ws) => ws.arena_status === 'promoted'
  ).length;
  const archived = group.workspaces.filter(
    (ws) => ws.arena_status === 'archived'
  ).length;
  const active = total - promoted - archived;

  const { dissolve } = useArenaActions(group.id, group.issue_id);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const groupAlreadyPromoted = group.promoted_workspace_id != null;

  const handleDissolve = async () => {
    setErrorMessage(null);
    const result = await ConfirmDialog.show({
      title: 'Dissolve this arena?',
      message: `Archives all ${total} attempt${total === 1 ? '' : 's'}. Their worktrees will be cleaned up automatically. This cannot be undone.`,
      confirmText: 'Dissolve',
      cancelText: 'Cancel',
      variant: 'destructive',
    });
    if (result !== 'confirmed') return;

    try {
      await dissolve.mutateAsync();
      onDissolved?.();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Dissolve failed');
    }
  };

  return (
    <div className="border-b border-zinc-200 px-base py-half dark:border-zinc-800">
      <div className="flex items-start justify-between gap-base">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-medium">Arena · {total} attempts</h2>
          <p className="mt-1 line-clamp-2 max-w-2xl text-xs text-low">
            {group.prompt}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-half">
          <div className="text-xs text-low">
            {active} running · {promoted} promoted · {archived} archived
          </div>
          {!groupAlreadyPromoted ? (
            <Button
              size="xs"
              variant="outline"
              onClick={() => void handleDissolve()}
              disabled={dissolve.isPending}
              aria-label="Dissolve this arena group"
            >
              {dissolve.isPending ? 'Dissolving…' : 'Dissolve'}
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
        Failed to load arena group: {(error as Error).message}
      </div>
    );
  }

  if (isLoading || !data) {
    return <div className="p-base text-sm text-low">Loading arena…</div>;
  }

  const columnsClassName =
    data.workspaces.length === 1
      ? 'grid-cols-1'
      : data.workspaces.length === 2
        ? 'grid-cols-1 md:grid-cols-2'
        : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3';

  return (
    <div className="flex h-full flex-col">
      <ArenaHeader group={data} onDissolved={handleDissolved} />

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
    </div>
  );
}
