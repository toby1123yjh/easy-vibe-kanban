import { useState } from 'react';
import { BaseCodingAgent, type ExecutorConfig } from 'shared/types';
import { Button } from '@vibe/ui/components/Button';
import { Textarea } from '@vibe/ui/components/Textarea';
import { useArenaActions } from '@/shared/hooks/useArenaActions';
import type {
  ArenaGroupResponse,
  ArenaWorkspaceSummary,
} from '@/shared/lib/arenaApi';

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

function workspaceLabel(workspace: ArenaWorkspaceSummary, index: number) {
  return workspace.name || workspace.executor || `Attempt ${index + 1}`;
}

export function ArenaPageActions({ group }: ArenaPageActionsProps) {
  const [messageText, setMessageText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { message, startImplementation } = useArenaActions(
    group.id,
    group.issue_id
  );

  if (group.mode !== 'design' || group.lifecycle_status !== 'open') {
    return null;
  }

  const isRunning = group.workspaces.some(
    (workspace) => workspace.latest_execution_status === 'running'
  );
  const isPending = message.isPending || startImplementation.isPending;
  const actionsDisabled =
    isRunning || isPending || group.workspaces.length === 0;
  const trimmedMessage = messageText.trim();

  const handleAskAll = async () => {
    if (!trimmedMessage || actionsDisabled) return;

    setErrorMessage(null);
    try {
      for (const workspace of group.workspaces) {
        await message.mutateAsync({
          target: {
            type: 'workspace',
            workspace_id: workspace.workspace_id,
          },
          prompt: trimmedMessage,
          executor_config: executorConfigForWorkspace(workspace),
        });
      }
      setMessageText('');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Ask all failed');
    }
  };

  const handleChallengeFrom = async (source: ArenaWorkspaceSummary) => {
    if (actionsDisabled || group.workspaces.length < 2) return;

    setErrorMessage(null);
    try {
      for (const responder of group.workspaces) {
        if (responder.workspace_id === source.workspace_id) continue;
        await message.mutateAsync({
          target: {
            type: 'challenge',
            source_workspace_id: source.workspace_id,
            responder_workspace_id: responder.workspace_id,
          },
          prompt:
            'Compare your current answer with the other attempt. Call out disagreements, stronger ideas, risks, and what you would change.',
          executor_config: executorConfigForWorkspace(responder),
        });
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Challenge failed');
    }
  };

  const handleSynthesize = async () => {
    if (actionsDisabled) return;

    setErrorMessage(null);
    try {
      await message.mutateAsync({
        target: { type: 'synthesize' },
        prompt:
          'Synthesize the Arena attempts into a concise decision memo. Preserve disagreement, tradeoffs, and open risks.',
        executor_config: executorConfigForWorkspace(group.workspaces[0]),
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Synthesize failed');
    }
  };

  const handleStartImplementation = async (
    workspace: ArenaWorkspaceSummary
  ) => {
    if (actionsDisabled) return;

    setErrorMessage(null);
    try {
      await startImplementation.mutateAsync({
        workspace_id: workspace.workspace_id,
        follow_up_prompt: null,
        executor_config: null,
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Start implementation failed'
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
            placeholder="Ask every attempt a follow-up..."
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
            Ask all
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={actionsDisabled || group.workspaces.length < 2}
            onClick={() => void handleSynthesize()}
          >
            Synthesize
          </Button>
        </div>
      </div>

      <div className="mt-half flex flex-wrap items-center gap-half">
        {group.workspaces.map((workspace, index) => (
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
              disabled={actionsDisabled || group.workspaces.length < 2}
              onClick={() => void handleChallengeFrom(workspace)}
            >
              Challenge
            </Button>
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={actionsDisabled}
              onClick={() => void handleStartImplementation(workspace)}
            >
              Start implementation
            </Button>
          </div>
        ))}
      </div>

      {isRunning ? (
        <p className="mt-half text-xs text-low">Arena attempts are running.</p>
      ) : null}
      {errorMessage ? (
        <p className="mt-half text-xs text-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
