import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import NiceModal from '@ebay/nice-modal-react';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import type { SessionListItem, TaskSummary } from 'shared/types';
import { useDeleteTaskSession } from '@/shared/hooks/useDeleteTaskSession';
import { getHostRequestScopeQueryKey } from '@/shared/lib/hostRequestScope';
import { ProductSidebar } from '@/features/app-shell/ui/ProductSidebar';
import { ProjectKanbanView } from '@/features/projects/ui/ProjectKanbanView';
import type { AppShellCapabilityAdapter } from '@/features/app-shell/model/appShell';
import i18n from '@/i18n/config';
import '../../../packages/ui/src/styles/tokens.css';
import '@/features/app-shell/ui/app-shell.css';
import './style.css';

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});
const params = new URLSearchParams(location.search);
void i18n.changeLanguage(params.get('locale') ?? 'en');
const section = <T,>(items: T[]) => ({
  items,
  isLoading: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  retry() {},
  loadNextPage() {},
});

function Fixture() {
  const [hostId, setHostId] = useState<string | null>(null);
  const [selection, setSelection] = useState('session-1');
  const [navigations, setNavigations] = useState(0);
  const [confirmation, setConfirmation] = useState('');
  const scope = JSON.stringify([hostId, selection]);
  const discoveryScope = JSON.stringify(['local', hostId, 'fixture']);
  const { data: sessions = [] } = useQuery<SessionListItem[]>({
    queryKey: ['app-shell', 'discovery', discoveryScope, 'sessions'],
    queryFn: async () =>
      (await fetch(`/__fixture/sessions?host=${hostId ?? 'local'}`)).json(),
  });
  const { data: tasks = [] } = useQuery<TaskSummary[]>({
    queryKey: [
      'project-tasks',
      'project-1',
      getHostRequestScopeQueryKey(hostId),
    ],
    queryFn: async () =>
      (await fetch(`/__fixture/tasks?host=${hostId ?? 'local'}`)).json(),
  });
  const deletion = useDeleteTaskSession({
    hostId,
    scopeKey: scope,
    discoveryScopeKey: discoveryScope,
    onDeleted: (target) => {
      if (selection === target.sessionId) {
        setSelection('remaining');
        setNavigations((count) => count + 1);
      }
    },
  });
  // Production surfaces mount independently; exercise shared confirmation ownership.
  const projectDeletion = useDeleteTaskSession({
    hostId,
    scopeKey: scope,
    discoveryScopeKey: discoveryScope,
    onDeleted: (target) => {
      if (selection === target.sessionId) {
        setSelection('remaining');
        setNavigations((count) => count + 1);
      }
    },
  });
  const modules = Object.fromEntries(
    ['dashboard', 'projects', 'workflows', 'agents'].map((name) => [
      name,
      {
        availability: 'available',
        navigate() {},
      },
    ])
  ) as AppShellCapabilityAdapter['moduleCapabilities'];
  const adapter: AppShellCapabilityAdapter = {
    deployment: 'local',
    discoveryHostId: hostId,
    discoveryScopeKey: discoveryScope,
    environmentLabel: 'Fixture',
    moduleCapabilities: modules,
    navigateToRoute() {},
    openSettings() {},
  };
  return (
    <>
      <div className="fixture-controls">
        <button onClick={() => setHostId('remote-host')}>Switch host</button>
        <button onClick={() => setSelection('session-2')}>
          Switch selection
        </button>
        <button onClick={() => void i18n.changeLanguage('zh-Hans')}>
          Switch language
        </button>
        <button
          onClick={() =>
            void ConfirmDialog.show({
              title: 'Basic confirmation',
              message: 'Existing confirmation contract',
              variant: 'destructive',
            }).then(setConfirmation)
          }
        >
          Basic confirmation
        </button>
        <output data-testid="confirmation">{confirmation}</output>
        <output data-testid="selection">{selection}</output>
        <output data-testid="host">{hostId ?? 'local'}</output>
        <output data-testid="navigations">{navigations}</output>
        <output data-testid="pending">{deletion.pendingSessionId ?? ''}</output>
        <output data-testid="task-count">{tasks.length}</output>
        <output data-testid="session-count">{sessions.length}</output>
      </div>
      <div className="fixture-layout">
        <div data-testid="sidebar">
          <ProductSidebar
            adapter={adapter}
            activeModule={null}
            activeProjectId={null}
            activeSessionId={selection}
            projects={section([])}
            sessions={section(sessions)}
            newSession={{ availability: 'available', navigate: () => {} }}
            objectDrawerOpen={false}
            onObjectDrawerOpenChange={() => {}}
            onSearch={() => {}}
            onProject={() => {}}
            onSession={(row) => setSelection(row.id)}
            deletingSessionId={deletion.pendingSessionId}
            onDeleteSession={(row) =>
              void deletion.deleteSession({
                sessionId: row.id,
                workspaceId: row.workspace_id,
                title: row.title,
              })
            }
          />
        </div>
        <div data-testid="project" className="fixture-project">
          <ProjectKanbanView
            projectName="Fixture project"
            query=""
            selectedIssueId={null}
            issueCount={1}
            dragDisabled={false}
            taskSource={{ state: 'ready' }}
            columns={[
              {
                id: 'todo',
                name: 'Todo',
                color: '220 16% 56%',
                sortOrder: 1,
                issues: [
                  {
                    id: 'issue-1',
                    simpleId: 'VK-1',
                    title: 'Keep this Issue',
                    statusId: 'todo',
                    priority: null,
                    sortOrder: 1,
                    tags: [],
                    tasks,
                  },
                ],
              },
            ]}
            onQueryChange={() => {}}
            onCreateIssue={() => {}}
            onOpenIssue={() => {}}
            onOpenTask={() => {}}
            onDeleteIssue={async () => {
              throw new Error('Must not delete Issue');
            }}
            getTaskUnavailableReason={() => null}
            onMove={async () => {}}
            deletingSessionId={projectDeletion.pendingSessionId}
            onDeleteTask={(task) => {
              if (task.open_target.kind === 'agent')
                void projectDeletion.deleteSession({
                  taskId: task.id,
                  sessionId: task.open_target.session_id,
                  workspaceId: task.open_target.workspace_id,
                  title: task.title,
                });
            }}
          />
        </div>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <NiceModal.Provider>
      <Fixture />
    </NiceModal.Provider>
  </QueryClientProvider>
);
