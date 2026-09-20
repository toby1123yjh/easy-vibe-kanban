import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { MessagesSquare, Plus, Trash2 } from 'lucide-react';
import type { SessionCursor } from 'shared/types';
import { Button } from '@vibe/ui/components/Button';
import { executionDataApi } from '@/shared/lib/executionDataApi';
import { useAppShellProjects } from '@/shared/hooks/useAppShellProjects';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useDeleteTaskSession } from '@/shared/hooks/useDeleteTaskSession';
import { DEFAULT_PROJECT_ID } from '@/shared/lib/defaultProject';
import { sessionRoute } from '@/features/app-shell/model/appShell';

interface ProjectSessionsProps {
  projectId: string;
  variant?: 'list' | 'column';
}

export function ProjectSessions({
  projectId,
  variant = 'list',
}: ProjectSessionsProps) {
  const shell = useAppShellProjects();
  return (
    <ProjectSessionsContent
      key={`${shell?.scopeKey}:${projectId}`}
      projectId={projectId}
      variant={variant}
    />
  );
}

function ProjectSessionsContent({ projectId, variant }: ProjectSessionsProps) {
  const { t } = useTranslation('common');
  const shell = useAppShellProjects();
  const hostId = shell?.hostId ?? null;
  const enabled =
    Boolean(shell) && !(shell?.deployment === 'remote' && !hostId);
  const navigate = useNavigate();
  const navigation = useAppNavigation();
  const isColumn = variant === 'column';
  const query = useInfiniteQuery({
    queryKey: ['project-sessions', shell?.scopeKey, projectId],
    enabled,
    initialPageParam: null as SessionCursor | null,
    queryFn: ({ pageParam, signal }) =>
      executionDataApi.listRecentSessions({
        projectId,
        hostId,
        cursor: pageParam,
        signal,
      }),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    refetchInterval: 10_000,
  });
  const { deleteSession, pendingSessionId } = useDeleteTaskSession({
    hostId,
    scopeKey: `${shell?.scopeKey}:${projectId}`,
    onDeleted: () => {
      void query.refetch();
    },
  });
  const sessions = Array.from(
    new Map(
      (
        query.data?.pages
          .flatMap((page) => page.sessions)
          .filter((session) => !session.task_id) ?? []
      ).map((session) => [session.id, session])
    ).values()
  );
  const content = (
    <div className={isColumn ? 'vk-kanban-column__cards' : 'space-y-base'}>
      {!enabled && <p role="alert">{t('defaultProject.offline')}</p>}
      {enabled && query.isPending && <p role="status">{t('states.loading')}</p>}
      {query.isError && (
        <div role="alert">
          <p>{t('defaultProject.loadFailed')}</p>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => {
              if (query.isFetchNextPageError) void query.fetchNextPage();
              else void query.refetch();
            }}
          >
            {t('buttons.retry')}
          </Button>
        </div>
      )}
      {enabled &&
        !query.isPending &&
        !query.isError &&
        sessions.length === 0 && (
          <p className="text-low">
            {isColumn
              ? t('projectSessions.empty', {
                  defaultValue: 'No discussions yet.',
                })
              : t('defaultProject.empty')}
          </p>
        )}
      {sessions.map((session) => (
        <article
          key={session.id}
          data-session-id={session.id}
          className={
            isColumn
              ? 'vk-session-column-card'
              : 'flex flex-wrap items-center gap-base rounded-sm border border-border p-base'
          }
        >
          <button
            type="button"
            disabled={!enabled}
            className={
              isColumn
                ? 'vk-session-column-card__open'
                : 'min-w-0 flex-1 truncate text-left hover:underline'
            }
            title={session.title}
            onClick={() =>
              void navigate({
                to: `${shell?.deployment === 'remote' ? `/hosts/${encodeURIComponent(hostId ?? '')}` : ''}${sessionRoute(session)}`,
              })
            }
          >
            {session.title}
          </button>
          <Button
            variant="ghost"
            className={isColumn ? 'vk-session-column-card__delete' : undefined}
            aria-label={
              isColumn ? `${t('buttons.delete')} ${session.title}` : undefined
            }
            title={t('buttons.delete')}
            disabled={!enabled || pendingSessionId !== null}
            onClick={() =>
              void deleteSession({
                sessionId: session.id,
                workspaceId: session.workspace_id,
                title: session.title,
              })
            }
          >
            {isColumn ? (
              <Trash2 size={15} aria-hidden="true" />
            ) : (
              t('buttons.delete')
            )}
          </Button>
        </article>
      ))}
      {query.hasNextPage && (
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          {t('defaultProject.more')}
        </Button>
      )}
    </div>
  );
  if (!isColumn) return content;
  return (
    <section
      className="vk-kanban-column vk-session-column"
      aria-label={t('projectSessions.column', { defaultValue: 'Discussions' })}
    >
      <header className="vk-kanban-column__header">
        <MessagesSquare size={14} aria-hidden="true" />
        <h2>{t('projectSessions.column', { defaultValue: 'Discussions' })}</h2>
        <span className="vk-kanban-column__count">
          {sessions.length}
          {query.hasNextPage ? '+' : ''}
        </span>
        <button
          type="button"
          aria-label={t('projectSessions.create', {
            defaultValue: 'New discussion',
          })}
          title={
            navigation.agentExecutionUnavailableReason ??
            t('projectSessions.create', { defaultValue: 'New discussion' })
          }
          disabled={
            !enabled || Boolean(navigation.agentExecutionUnavailableReason)
          }
          onClick={() =>
            navigation.goToProjectWorkspaceCreate(
              projectId,
              crypto.randomUUID()
            )
          }
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </header>
      {content}
    </section>
  );
}

export function DefaultProjectPage() {
  const { t } = useTranslation('common');
  const shell = useAppShellProjects();
  const navigation = useAppNavigation();
  return (
    <section className="h-full overflow-auto p-double">
      <div className="mx-auto max-w-5xl space-y-double">
        <header className="flex items-center justify-between gap-base">
          <h1 className="text-xl font-semibold">{t('defaultProject.name')}</h1>
          <Button
            disabled={Boolean(navigation.agentExecutionUnavailableReason)}
            onClick={() => navigation.goToWorkspacesCreate()}
          >
            {t('appShell.objects.newSession')}
          </Button>
        </header>
        <ProjectSessions
          key={`${shell?.scopeKey}:${DEFAULT_PROJECT_ID}`}
          projectId={DEFAULT_PROJECT_ID}
        />
      </div>
    </section>
  );
}
