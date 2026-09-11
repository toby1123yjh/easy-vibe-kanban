import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  BaseCodingAgent,
  PermissionPolicy,
  type ExecutorConfig,
  type ExecutorProfile,
} from 'shared/types';
import { useSessionExecutorConfig } from '@/features/workspace-chat/model/hooks/useSessionExecutorConfig';
import { useCreateSession } from '@/features/workspace-chat/model/hooks/useCreateSession';
import { useSessionQueueInteraction } from '@/features/workspace-chat/model/hooks/useSessionQueueInteraction';
import { switchHost, useHostId } from './mocks';

const params = new URLSearchParams(location.search);
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const profiles: Record<string, ExecutorProfile> = {
  CODEX: { DEFAULT: undefined, PLAN: undefined },
  CLAUDE_CODE: { DEFAULT: undefined, CUSTOM: undefined },
};

function Composer({
  sessionId,
  onCreated,
}: {
  sessionId: string | undefined;
  onCreated(): void;
}) {
  const hostId = useHostId();
  const createSession = useCreateSession({ onSessionCreated: onCreated });
  const queue = useSessionQueueInteraction({
    sessionId: params.has('queued') ? sessionId : undefined,
  });
  const [scratch, setScratch] = useState<ExecutorConfig | undefined>(() => {
    if (params.has('omitted-draft'))
      return { executor: BaseCodingAgent.CODEX, variant: 'PLAN' };
    if (params.has('wrong-draft'))
      return {
        executor: BaseCodingAgent.CLAUDE_CODE,
        variant: 'CUSTOM',
        model_id: 'wrong-draft',
      };
    if (params.has('null-draft'))
      return {
        executor: BaseCodingAgent.CODEX,
        variant: 'PLAN',
        model_id: null,
        agent_id: null,
        reasoning_id: null,
        permission_policy: null,
      };
    return undefined;
  });
  const state = useSessionExecutorConfig({
    sessionId,
    workspaceId: 'workspace-1',
    sessionExecutor:
      sessionId === 'b' ? 'CLAUDE_CODE' : sessionId ? 'CODEX' : null,
    isNewSessionMode: !sessionId,
    profiles,
    scratchConfig: queue.isQueued ? queue.queuedConfig : scratch,
    isScratchLoading: false,
    preferredExecutorConfig: params.has('preferred')
      ? {
          executor: BaseCodingAgent.CLAUDE_CODE,
          variant: 'CUSTOM',
          model_id: 'wrong-preferred',
        }
      : undefined,
    configExecutorProfile: {
      executor: BaseCodingAgent.CLAUDE_CODE,
      variant: 'DEFAULT',
    },
    onPersist: setScratch,
  });
  return (
    <>
      <output data-testid="config">
        {JSON.stringify(state.executorConfig)}
      </output>
      <output data-testid="state">
        {state.configError
          ? 'error'
          : state.isConfigLoading
            ? 'loading'
            : 'ready'}
      </output>
      <output data-testid="error">{state.configError?.message}</output>
      <output data-testid="create-state">{createSession.status}</output>
      <output data-testid="queue-config">
        {JSON.stringify(queue.queuedConfig)}
      </output>
      <button onClick={() => state.setExecutor(BaseCodingAgent.CODEX)}>
        Choose Codex
      </button>
      <button onClick={() => state.setExecutor(BaseCodingAgent.CLAUDE_CODE)}>
        Choose Claude
      </button>
      <button onClick={() => state.setVariant('CUSTOM')}>Change preset</button>
      <button
        onClick={() =>
          state.setOverrides({
            model_id: 'chosen-model',
            agent_id: 'chosen-agent',
            reasoning_id: 'high',
            permission_policy: PermissionPolicy.SUPERVISED,
          })
        }
      >
        Choose settings
      </button>
      <button
        onClick={() =>
          state.setOverrides({
            model_id: null,
            agent_id: null,
            reasoning_id: null,
            permission_policy: null,
          })
        }
      >
        Follow CLI
      </button>
      <button onClick={() => void state.refetchConfig()}>Retry</button>
      <button
        disabled={
          !state.executorConfig || state.isConfigLoading || !!state.configError
        }
        onClick={async () => {
          if (params.has('create-race') && state.executorConfig) {
            await createSession.mutateAsync({
              workspaceId: 'workspace-1',
              prompt: 'fixture only',
              executorConfig: state.executorConfig,
            });
            setScratch(undefined);
            return;
          }
          await fetch(
            `/__fixture/session-config/${sessionId ?? 'a'}?host=${hostId ?? 'local'}`,
            { method: 'POST', body: JSON.stringify(state.executorConfig) }
          );
          setScratch(undefined);
          await client.invalidateQueries({
            queryKey: ['session-executor-config'],
          });
          onCreated();
        }}
      >
        Send fixture message
      </button>
    </>
  );
}

function Fixture() {
  const [sessionId, setSessionId] = useState<string | undefined>(
    params.has('new') ? undefined : 'a'
  );
  const [mountKey, setMountKey] = useState(0);
  return (
    <>
      <button onClick={() => setSessionId('a')}>Session A</button>
      <button onClick={() => setSessionId('b')}>Session B</button>
      <button onClick={switchHost}>Switch host</button>
      <button
        onClick={() => {
          client.clear();
          setMountKey((key) => key + 1);
        }}
      >
        Reopen
      </button>
      <Composer
        key={mountKey}
        sessionId={sessionId}
        onCreated={() => setSessionId('a')}
      />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <Fixture />
  </QueryClientProvider>
);
