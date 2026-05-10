import { useMemo, useState } from 'react';
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
import { cn } from '@/shared/lib/utils';
import { buildArenaWinnerOptions } from '../model/workflowRunView';

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
  const { selectArenaWinner, isSelectingArenaWinner } =
    useWorkflowRunMutations();
  const { invalidateGroup } = useArenaInvalidators();
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectingWorkspaceId, setSelectingWorkspaceId] = useState<
    string | null
  >(null);
  const {
    data: arenaGroup,
    error: arenaError,
    isLoading,
  } = useArenaGroup(arenaGroupId, {
    enabled: !!arenaGroupId,
  });

  const options = useMemo(
    () => buildArenaWinnerOptions(arenaGroup),
    [arenaGroup]
  );

  const arenaHref = arenaGroupId
    ? `/projects/${projectId}/issues/${issueId}/arena/${arenaGroupId}`
    : null;

  const handleSelect = async (workspaceId: string) => {
    setActionError(null);
    setSelectingWorkspaceId(workspaceId);
    try {
      await selectArenaWinner({
        runId,
        nodeId,
        payload: { workspace_id: workspaceId },
      });
      if (arenaGroupId) {
        invalidateGroup(arenaGroupId);
      }
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to select arena winner.'
      );
    } finally {
      setSelectingWorkspaceId(null);
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
            Arena selection required
          </h4>
          <p className="mt-1 text-xs text-high">
            Pick a completed attempt to apply its diff back to the workflow
            workspace.
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
        <p className="text-xs text-low">Arena group link is not available.</p>
      ) : isLoading ? (
        <div className="flex items-center gap-half text-xs text-low">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading attempts...
        </div>
      ) : arenaError ? (
        <p className="text-xs text-error" role="alert">
          Failed to load arena group:{' '}
          {arenaError instanceof Error ? arenaError.message : 'Unknown error'}
        </p>
      ) : options.length === 0 ? (
        <p className="text-xs text-low">No arena attempts are available yet.</p>
      ) : (
        <div className="space-y-half">
          {options.map((option) => {
            const workspaceHref = `/projects/${projectId}/issues/${issueId}/workspaces/${option.workspaceId}`;
            const isApplying =
              isSelectingArenaWinner &&
              selectingWorkspaceId === option.workspaceId;

            return (
              <div
                key={option.workspaceId}
                className={cn(
                  'rounded border bg-panel p-half text-xs',
                  option.isPromoted ? 'border-success/60' : 'border-secondary'
                )}
              >
                <div className="flex items-start justify-between gap-half">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-half">
                      {option.isPromoted ? (
                        <CheckCircle className="h-3.5 w-3.5 text-success" />
                      ) : option.isSelectable ? (
                        <Swords className="h-3.5 w-3.5 text-warning" />
                      ) : (
                        <AlertCircle className="h-3.5 w-3.5 text-low" />
                      )}
                      <span className="truncate font-medium text-high">
                        {option.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-half gap-y-1 text-low">
                      <span>{option.executorLabel}</span>
                      <span>{option.executionStatusLabel}</span>
                      <span>{option.arenaStatusLabel}</span>
                      <span>
                        {option.hasUncommittedChanges === true
                          ? 'changes'
                          : option.hasUncommittedChanges === false
                            ? 'no changes'
                            : 'changes unknown'}
                      </span>
                    </div>
                    <div className="flex min-w-0 items-center gap-half text-low">
                      <GitBranch className="h-3 w-3 shrink-0" />
                      <span className="truncate font-mono">
                        {option.branch}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-half">
                    <a
                      className="inline-flex min-h-8 items-center rounded border border-secondary px-half py-1 text-xs font-medium text-brand hover:bg-secondary"
                      href={workspaceHref}
                      aria-label={`Open ${option.label} workspace`}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <Button
                      type="button"
                      size="xs"
                      disabled={!option.isSelectable || isSelectingArenaWinner}
                      onClick={() => void handleSelect(option.workspaceId)}
                    >
                      {option.isPromoted
                        ? 'Selected'
                        : isApplying
                          ? 'Applying...'
                          : 'Select winner'}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {actionError ? (
        <p className="text-xs text-error" role="alert">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}
