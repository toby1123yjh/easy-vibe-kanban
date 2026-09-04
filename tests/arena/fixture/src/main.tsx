import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArenaView } from '../../../../packages/web-core/src/features/arena/ui/ArenaView';
import { arenaQueryKeys } from '../../../../packages/web-core/src/shared/hooks/useArenaGroup';
import type { ArenaGroupResponse } from '../../../../packages/web-core/src/shared/lib/arenaApi';
import {
  setLocalApiTransport,
  type LocalApiTransport,
} from '../../../../packages/web-core/src/shared/lib/localApiTransport';
import '../../../../packages/web-core/src/i18n/config';
import '../../../../packages/ui/src/styles/tokens.css';
import './style.css';

const now = '2026-09-03T00:00:00.000Z';

function createGroup(candidateCount: number): ArenaGroupResponse {
  return {
    id: 'arena-fixture',
    task_id: 'task-fixture',
    prompt: 'Compare candidate implementations',
    base_branch: 'main',
    mode: 'design',
    lifecycle_status: 'open',
    winner_candidate_id: null,
    promoted_at: null,
    closed_at: null,
    created_at: now,
    updated_at: now,
    workspaces: Array.from({ length: candidateCount }, (_, index) => ({
      candidate_id: `candidate-${index + 1}`,
      workspace_id: `workspace-${index + 1}`,
      session_id: `session-${index + 1}`,
      name: `Candidate ${index + 1}`,
      branch: `arena/candidate-${index + 1}`,
      purpose:
        index === candidateCount - 1 && candidateCount > 3
          ? 'synthesis'
          : 'attempt',
      arena_status: 'active',
      executor: index % 2 === 0 ? 'CODEX' : 'CLAUDE_CODE',
      variant: null,
      latest_agent_run_status: 'succeeded',
      has_uncommitted_changes: false,
    })),
    events: [],
  };
}

const candidateCount = new URLSearchParams(window.location.search).get('many')
  ? 4
  : 3;
const group = createGroup(candidateCount);

const jsonResponse = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const transport: LocalApiTransport = {
  request: async (path) => {
    if (path.includes('/arena/arena-fixture')) return jsonResponse(group);
    if (path.includes('/agent-runs/session/')) {
      return jsonResponse({ success: true, data: [] });
    }
    return jsonResponse({});
  },
  openWebSocket: () => {
    const socket: Partial<WebSocket> & {
      onopen: ((event: Event) => void) | null;
      onmessage: ((event: MessageEvent) => void) | null;
      onerror: ((event: Event) => void) | null;
      onclose: ((event: CloseEvent) => void) | null;
    } = {
      readyState: WebSocket.OPEN,
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
      close: () => undefined,
      send: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    window.setTimeout(() => {
      socket.onopen?.(new Event('open'));
      socket.onmessage?.(
        new MessageEvent('message', { data: JSON.stringify({ Ready: true }) })
      );
    }, 0);
    return socket as WebSocket;
  },
};

setLocalApiTransport(transport);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});
queryClient.setQueryData(arenaQueryKeys.group('arena-fixture'), group);

const constrained = new URLSearchParams(window.location.search).has(
  'constrained'
);

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <main
      className={`arena-fixture${constrained ? ' arena-fixture--constrained' : ''}`}
    >
      <ArenaView
        groupId="arena-fixture"
        buildWorkspaceHref={(workspaceId) => `/workspace/${workspaceId}`}
      />
    </main>
  </QueryClientProvider>
);
