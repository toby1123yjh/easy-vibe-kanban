import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderGit2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { DraftWorkspaceRepo } from 'shared/types';
import { useWorkspaceWithSession } from '@/shared/hooks/useWorkspace';
import { useWorkspaceRepo } from '@/shared/hooks/useWorkspaceRepo';
import { repoApi } from '@/shared/lib/api';
import { cn } from '@/shared/lib/utils';
import { buildWorkspaceContext } from '@/shared/lib/workspaceContext';
import { useHostId } from '@/shared/providers/HostIdProvider';

export interface WorkspaceContextHeaderProps {
  workspaceId?: string | null;
  draftRepo?: DraftWorkspaceRepo | null;
  className?: string;
}

export function WorkspaceContextHeader({
  workspaceId,
  draftRepo,
  className,
}: WorkspaceContextHeaderProps) {
  const { t } = useTranslation('common');
  const hostId = useHostId();
  const normalizedWorkspaceId = workspaceId ?? undefined;
  const workspaceQuery = useWorkspaceWithSession(normalizedWorkspaceId);
  const workspaceRepos = useWorkspaceRepo(normalizedWorkspaceId, {
    enabled: !!normalizedWorkspaceId,
  });
  const shouldLoadDraftRepo = !normalizedWorkspaceId && !!draftRepo;
  const draftRepoQuery = useQuery({
    queryKey: ['workspace-context-draft-repo', hostId, draftRepo?.repo_id],
    queryFn: () => repoApi.getById(draftRepo!.repo_id, hostId),
    enabled: shouldLoadDraftRepo,
  });

  const parts = useMemo(() => {
    if (workspaceQuery.data) {
      const fallbackRepoName =
        workspaceRepos.repos.length === 1
          ? workspaceRepos.repos[0].name
          : undefined;
      return buildWorkspaceContext({
        containerRef: workspaceQuery.data.container_ref,
        workingDir: workspaceQuery.data.session?.agent_working_dir,
        fallbackRepoName,
        branch: workspaceQuery.data.branch,
        workspaceKind: workspaceQuery.data.workspace_kind,
      });
    }

    if (draftRepo && draftRepoQuery.data) {
      return buildWorkspaceContext({
        containerRef: draftRepoQuery.data.path,
        branch: draftRepo.target_branch,
        workspaceKind: 'worktree',
        worktreeLabel: t('workflow.workspaceContext.pendingWorktree', {
          defaultValue: 'Worktree pending',
        }),
      });
    }

    return [];
  }, [
    draftRepo,
    draftRepoQuery.data,
    t,
    workspaceQuery.data,
    workspaceRepos.repos,
  ]);

  const isLoading = normalizedWorkspaceId
    ? workspaceQuery.isLoading || workspaceRepos.isLoading
    : shouldLoadDraftRepo && draftRepoQuery.isLoading;

  if (isLoading) {
    return (
      <div
        className={cn(
          'h-4 w-56 animate-pulse rounded-sm bg-secondary',
          className
        )}
        aria-label={t('workflow.workspaceContext.loading', {
          defaultValue: 'Loading workspace context',
        })}
      />
    );
  }

  if (parts.length === 0) {
    return (
      <p className={cn('truncate text-xs text-low', className)}>
        {t('workflow.workspaceContext.unavailable', {
          defaultValue: 'Workspace context is not available yet',
        })}
      </p>
    );
  }

  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-half text-xs text-low',
        className
      )}
      aria-label={t('workflow.workspaceContext.label', {
        defaultValue: 'Working context',
      })}
    >
      <FolderGit2 className="size-icon-xs shrink-0" aria-hidden="true" />
      {parts.map((part, index) => (
        <div key={`${part.kind}-${part.label}`} className="contents">
          {index > 0 ? <span className="shrink-0">/</span> : null}
          <span
            className={cn(
              'min-w-0 truncate',
              part.kind === 'path' ? 'max-w-[420px]' : 'max-w-[200px]'
            )}
            title={part.label}
          >
            {part.label}
          </span>
        </div>
      ))}
    </div>
  );
}
