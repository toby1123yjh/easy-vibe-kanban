import { useDiffSummary } from '@/shared/hooks/useDiffSummary';
import type {
  ArenaGroupResponse,
  ArenaWorkspaceSummary,
} from '@/shared/lib/arenaApi';
import { ArenaActionsBar } from './ArenaActionsBar';

interface ArenaWorkspaceColumnProps {
  group: ArenaGroupResponse;
  workspace: ArenaWorkspaceSummary;
  /** Optional URL for the column header → opens the workspace's full
   * detail page (with the standard ChangesPanelContainer). */
  detailHref?: string;
}

const STATUS_BADGE: Record<
  ArenaWorkspaceSummary['arena_status'],
  { label: string; className: string }
> = {
  active: {
    label: 'Running',
    className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  },
  promoted: {
    label: 'Promoted',
    className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  },
  archived: {
    label: 'Archived',
    className: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400',
  },
};

/**
 * One column inside the {@link ArenaView}: header (executor + status +
 * branch) and a lightweight diff summary streamed live from the
 * workspace.
 *
 * The full inline diff is intentionally NOT rendered here — clicking
 * the header link opens the workspace's normal detail page where the
 * existing `ChangesPanelContainer` (which uses a singleton zustand
 * store) takes over without conflict.
 */
export function ArenaWorkspaceColumn({
  group,
  workspace,
  detailHref,
}: ArenaWorkspaceColumnProps) {
  const { fileCount, added, deleted, error } = useDiffSummary(
    workspace.workspace_id
  );
  const badge = STATUS_BADGE[workspace.arena_status];

  const headerInner = (
    <>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="truncate">
          {workspace.executor || workspace.name || 'Workspace'}
        </span>
        {workspace.variant ? (
          <span className="text-xs text-low">· {workspace.variant}</span>
        ) : null}
      </div>
      <div className="mt-1 flex items-center gap-2 text-xs text-low">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}
        >
          {badge.label}
        </span>
        <span className="truncate font-ibm-plex-mono">{workspace.branch}</span>
      </div>
    </>
  );

  return (
    <div className="flex h-full min-w-0 flex-col rounded border border-zinc-200 bg-secondary dark:border-zinc-800">
      <div className="border-b border-zinc-200 p-base dark:border-zinc-800">
        {detailHref ? (
          <a
            href={detailHref}
            className="block hover:opacity-80"
            aria-label={`Open ${workspace.executor ?? workspace.name ?? 'workspace'} detail`}
          >
            {headerInner}
          </a>
        ) : (
          headerInner
        )}
      </div>

      <div className="flex-1 overflow-auto p-base">
        {error ? (
          <div className="text-xs text-error">Diff stream error: {error}</div>
        ) : fileCount === 0 ? (
          <div className="text-xs text-low">
            {workspace.arena_status === 'active'
              ? 'Waiting for first changes…'
              : 'No file changes yet.'}
          </div>
        ) : (
          <ul className="space-y-1 text-xs font-ibm-plex-mono">
            <li className="flex items-center justify-between">
              <span className="text-low">
                {fileCount} {fileCount === 1 ? 'file' : 'files'}
              </span>
              <span className="space-x-2">
                <span className="text-emerald-600 dark:text-emerald-400">
                  +{added}
                </span>
                <span className="text-rose-600 dark:text-rose-400">
                  −{deleted}
                </span>
              </span>
            </li>
          </ul>
        )}
      </div>

      <ArenaActionsBar group={group} workspace={workspace} />
    </div>
  );
}
