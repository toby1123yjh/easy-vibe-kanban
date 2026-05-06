import { useNavigate, useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  arenaQueryKeys,
  useActiveArenaForIssue,
} from '@/shared/hooks/useArenaGroup';
import { CreateArenaDialog } from '@/features/arena';

interface IssueArenaSectionContainerProps {
  issueId: string;
  /** Suggested initial prompt for the new arena (e.g. issue title). */
  initialPrompt?: string;
}

/**
 * Compact entry point for AI Arena that lives next to the
 * existing IssueWorkspacesSection on the kanban issue panel.
 *
 * - When the issue already has an active (un-promoted) arena group:
 *   shows a "Open arena · N attempts" chip that links into ArenaView.
 * - When it doesn't: shows a [Start Arena] button that opens
 *   {@link CreateArenaDialog}.
 *
 * Keeping this section minimal lets us deliver the full Step 4 entry
 * point without rewriting `IssueWorkspacesSectionContainer`.
 */
export function IssueArenaSectionContainer({
  issueId,
  initialPrompt,
}: IssueArenaSectionContainerProps) {
  const { projectId } = useParams({ strict: false });
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    data: activeArena,
    isLoading,
    refetch,
  } = useActiveArenaForIssue(issueId);

  if (!projectId) return null;

  const goToArena = (groupId: string) => {
    const target =
      `/projects/${projectId}/issues/${issueId}/arena/${groupId}` as '/';
    void navigate({ to: target });
  };

  const handleStart = async () => {
    const latestArena = await refetch();
    if (latestArena.data) {
      goToArena(latestArena.data.id);
      return;
    }

    const result = await CreateArenaDialog.show({
      projectId,
      issueId,
      initialPrompt,
    });
    if (result.kind === 'created') {
      await queryClient.invalidateQueries({
        queryKey: arenaQueryKeys.activeForIssue(issueId),
      });
      goToArena(result.groupId);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  if (isLoading) {
    return null; // hidden until the issue's arena state is known
  }

  if (activeArena) {
    const total = activeArena.workspaces.length;
    const running = activeArena.workspaces.filter(
      (ws) => ws.latest_execution_status === 'running'
    ).length;
    const modeLabel =
      activeArena.mode === 'design' ? 'Design Arena' : 'Implementation Arena';
    return (
      <div className="my-half">
        <button
          type="button"
          onClick={() => goToArena(activeArena.id)}
          className="flex w-full items-center justify-between rounded border border-emerald-500/40 bg-emerald-500/5 px-base py-half text-sm hover:bg-emerald-500/10"
          aria-label="Open arena"
        >
          <span className="font-medium">
            {modeLabel} / {total} attempts ({running} running)
          </span>
          <span className="text-xs text-low">Open</span>
        </button>
      </div>
    );
  }

  return (
    <div className="my-half">
      <button
        type="button"
        onClick={() => void handleStart()}
        className="flex w-full items-center justify-between rounded border border-zinc-200 px-base py-half text-sm hover:bg-secondary dark:border-zinc-800"
        aria-label="Start Arena"
      >
        <span className="font-medium">AI Arena</span>
        <span className="text-xs text-low">Start Arena</span>
      </button>
    </div>
  );
}
