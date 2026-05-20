import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
  const { t } = useTranslation('common');
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
        err instanceof Error
          ? err.message
          : t('workflow.arenaWinner.selectFailed')
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
      ) : options.length === 0 ? (
        <p className="text-xs text-low">
          {t('workflow.arenaWinner.noAttempts')}
        </p>
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
                      <span>
                        {formatArenaExecutorLabel(option.executorLabel, t)}
                      </span>
                      <span>
                        {formatArenaStatusLabel(option.executionStatusLabel, t)}
                      </span>
                      <span>
                        {formatArenaStatusLabel(option.arenaStatusLabel, t)}
                      </span>
                      <span>
                        {option.hasUncommittedChanges === true
                          ? t('workflow.arenaWinner.changes')
                          : option.hasUncommittedChanges === false
                            ? t('workflow.arenaWinner.noChanges')
                            : t('workflow.arenaWinner.changesUnknown')}
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
                      aria-label={t('workflow.arenaWinner.openWorkspace', {
                        label: option.label,
                      })}
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

      {actionError ? (
        <p className="text-xs text-error" role="alert">
          {actionError}
        </p>
      ) : null}
    </div>
  );
}

function formatArenaExecutorLabel(
  label: string,
  t: TFunction<'common'>
): string {
  return label === 'Unknown executor'
    ? t('workflow.arenaWinner.unknownExecutor')
    : label;
}

function formatArenaStatusLabel(label: string, t: TFunction<'common'>): string {
  switch (label) {
    case 'not started':
      return t('workflow.arenaWinner.status.notStarted');
    case 'unknown':
      return t('workflow.arenaWinner.status.unknown');
    case 'active':
      return t('workflow.arenaWinner.status.active');
    case 'promoted':
      return t('workflow.arenaWinner.status.promoted');
    case 'completed':
      return t('workflow.arenaWinner.status.completed');
    case 'running':
      return t('workflow.arenaWinner.status.running');
    case 'failed':
      return t('workflow.arenaWinner.status.failed');
    case 'canceled':
      return t('workflow.arenaWinner.status.canceled');
    default:
      return label;
  }
}
