import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BaseCodingAgent, type ExecutorConfig } from 'shared/types';
import { Button } from '@vibe/ui/components/Button';
import { Textarea } from '@vibe/ui/components/Textarea';
import { useArenaActions } from '@/shared/hooks/useArenaActions';
import {
  isActiveArenaAgentRunStatus,
  type ArenaGroupResponse,
  type ArenaWorkspaceSummary,
} from '@/shared/lib/arenaApi';
import { SynthesizeArenaDialog } from './SynthesizeArenaDialog';

interface ArenaPageActionsProps {
  group: ArenaGroupResponse;
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

export function ArenaPageActions({ group }: ArenaPageActionsProps) {
  const { t } = useTranslation('common');
  const [messageText, setMessageText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { message, startImplementation } = useArenaActions(group.id, null);

  if (group.mode !== 'design' || group.lifecycle_status !== 'open') {
    return null;
  }

  const attemptWorkspaces = group.workspaces.filter(
    (workspace) => workspace.purpose === 'attempt'
  );
  const isRunning = group.workspaces.some((workspace) =>
    isActiveArenaAgentRunStatus(workspace.latest_agent_run_status)
  );
  const isPending = message.isPending || startImplementation.isPending;
  const actionsDisabled =
    isRunning || isPending || attemptWorkspaces.length === 0;
  const trimmedMessage = messageText.trim();
  const workspaceLabel = (workspace: ArenaWorkspaceSummary, index: number) =>
    workspace.name ||
    workspace.executor ||
    t('arena.workspace.attemptName', { index: index + 1 });

  const handleAskAll = async () => {
    if (!trimmedMessage || actionsDisabled) return;

    setErrorMessage(null);
    try {
      await message.mutateAsync({
        target: { type: 'all' },
        prompt: trimmedMessage,
        executor_config: executorConfigForWorkspace(attemptWorkspaces[0]),
        executor_configs: attemptWorkspaces.map((workspace) => ({
          workspace_id: workspace.workspace_id,
          executor_config: executorConfigForWorkspace(workspace),
        })),
      });
      setMessageText('');
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : t('arena.errors.askAllFailed')
      );
    }
  };

  const handleChallengeFrom = async (source: ArenaWorkspaceSummary) => {
    if (actionsDisabled || attemptWorkspaces.length < 2) return;

    setErrorMessage(null);
    try {
      for (const responder of attemptWorkspaces) {
        if (responder.workspace_id === source.workspace_id) continue;
        await message.mutateAsync({
          target: {
            type: 'challenge',
            source_workspace_id: source.workspace_id,
            responder_workspace_id: responder.workspace_id,
          },
          prompt: t('arena.pageActions.challengePrompt'),
          executor_config: executorConfigForWorkspace(responder),
        });
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : t('arena.errors.challengeFailed')
      );
    }
  };

  const handleSynthesize = async () => {
    if (actionsDisabled) return;

    setErrorMessage(null);
    try {
      const result = await SynthesizeArenaDialog.show({
        activityCount: group.events.length,
        attemptCount: attemptWorkspaces.length,
      });
      if (result.kind !== 'confirmed') return;

      await message.mutateAsync({
        target: { type: 'synthesize', options: result.options },
        prompt: result.prompt,
        executor_config: executorConfigForWorkspace(attemptWorkspaces[0]),
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : t('arena.errors.synthesizeFailed')
      );
    }
  };

  const handleStartImplementation = async (
    workspace: ArenaWorkspaceSummary
  ) => {
    if (actionsDisabled) return;

    setErrorMessage(null);
    try {
      await startImplementation.mutateAsync({
        candidate_id: workspace.candidate_id,
        follow_up_prompt: null,
        executor_config: null,
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : t('arena.errors.startImplementationFailed')
      );
    }
  };

  return (
    <div className="border-b border-zinc-200 bg-secondary px-base py-half dark:border-zinc-800">
      <div className="flex flex-col gap-half xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <Textarea
            value={messageText}
            onChange={(event) => {
              setMessageText(event.target.value);
              setErrorMessage(null);
            }}
            rows={2}
            placeholder={t('arena.pageActions.askPlaceholder')}
            className="min-h-16 font-ibm-plex-mono"
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-half">
          <Button
            type="button"
            size="xs"
            variant="default"
            disabled={actionsDisabled || !trimmedMessage}
            onClick={() => void handleAskAll()}
          >
            {t('arena.actions.askAll')}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={actionsDisabled || group.workspaces.length < 2}
            onClick={() => void handleSynthesize()}
          >
            {t('arena.actions.synthesize')}
          </Button>
        </div>
      </div>

      <div className="mt-half flex flex-wrap items-center gap-half">
        {attemptWorkspaces.map((workspace, index) => (
          <div
            key={workspace.workspace_id}
            className="flex items-center gap-half rounded border border-zinc-200 bg-primary px-half py-1 dark:border-zinc-800"
          >
            <span className="max-w-40 truncate text-xs text-low">
              {workspaceLabel(workspace, index)}
            </span>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={actionsDisabled || attemptWorkspaces.length < 2}
              onClick={() => void handleChallengeFrom(workspace)}
            >
              {t('arena.actions.challenge')}
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={actionsDisabled}
              onClick={() => void handleStartImplementation(workspace)}
            >
              {t('arena.actions.startImplementation')}
            </Button>
          </div>
        ))}
      </div>

      {isRunning ? (
        <p className="mt-half text-xs text-low">
          {t('arena.pageActions.attemptsRunning')}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="mt-half text-xs text-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
