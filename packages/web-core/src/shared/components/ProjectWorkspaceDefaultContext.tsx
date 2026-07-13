import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderGit2, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getProjectRepoDefaultsOrThrow } from '@/shared/hooks/useProjectRepoDefaults';
import { repoApi } from '@/shared/lib/api';
import { buildWorkspaceContext } from '@/shared/lib/workspaceContext';
import { cn } from '@/shared/lib/utils';
import { SettingsDialog } from '@/shared/dialogs/settings/SettingsDialog';

interface ProjectWorkspaceDefaultContextProps {
  projectId: string;
  organizationId: string;
  hostId?: string | null;
  variant?: 'bar' | 'inline' | 'panel';
  className?: string;
}

const projectWorkspaceDefaultQueryKey = (
  projectId: string,
  hostId?: string | null
) => ['project-workspace-default', hostId ?? 'local', projectId] as const;

export function ProjectWorkspaceDefaultContext({
  projectId,
  organizationId,
  hostId,
  variant = 'bar',
  className,
}: ProjectWorkspaceDefaultContextProps) {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const defaultContextQuery = useQuery({
    queryKey: projectWorkspaceDefaultQueryKey(projectId, hostId),
    queryFn: async () => {
      const defaults = await getProjectRepoDefaultsOrThrow(projectId, hostId);
      const selected = defaults?.[0];
      if (!selected) return null;
      if (!selected.target_branch.trim()) {
        throw new Error('Project default branch is empty');
      }

      const repo = await repoApi.getById(selected.repo_id, hostId);
      return {
        path: repo.path,
        branch: selected.target_branch,
      };
    },
    refetchOnMount: 'always',
  });

  const parts = useMemo(
    () =>
      defaultContextQuery.data
        ? buildWorkspaceContext({
            containerRef: defaultContextQuery.data.path,
            branch: defaultContextQuery.data.branch,
          })
        : [],
    [defaultContextQuery.data]
  );

  const openConfiguration = async () => {
    await SettingsDialog.show({
      initialSection: 'remote-projects',
      initialState: { organizationId, projectId },
      initialHostId: hostId ?? 'local',
    });
    await queryClient.invalidateQueries({
      queryKey: projectWorkspaceDefaultQueryKey(projectId, hostId),
    });
  };

  const isPanel = variant === 'panel';
  const isInline = variant === 'inline';
  const isConfigured = parts.length > 0;

  return (
    <section
      className={cn(
        'flex min-w-0 items-center gap-base',
        isPanel
          ? 'rounded-sm border border-border bg-secondary/40 p-base'
          : isInline
            ? 'max-w-full gap-half rounded-sm border border-border bg-secondary/40 px-half py-0.5'
            : 'px-base py-half',
        className
      )}
      aria-label={t('projectWorkspaceDefault.label', {
        defaultValue: 'Project default working location',
      })}
    >
      <FolderGit2
        className={cn(
          'size-icon-sm shrink-0',
          isConfigured ? 'text-brand' : 'text-low'
        )}
        aria-hidden="true"
      />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-half">
          {!isInline ? (
            <span className="shrink-0 text-xs font-medium text-normal">
              {t('projectWorkspaceDefault.label', {
                defaultValue: 'Project default working location',
              })}
            </span>
          ) : null}
          {defaultContextQuery.isLoading ? (
            <span
              className="h-3 w-48 animate-pulse rounded-sm bg-secondary"
              aria-label={t('projectWorkspaceDefault.loading', {
                defaultValue: 'Loading project working location',
              })}
            />
          ) : defaultContextQuery.isError ? (
            <span className="truncate text-xs text-error" role="status">
              {t('projectWorkspaceDefault.loadFailed', {
                defaultValue: 'Unable to load',
              })}
            </span>
          ) : isConfigured ? (
            <div className="flex min-w-0 items-center gap-half font-ibm-plex-mono text-xs text-low">
              {parts.map((part, index) => (
                <div key={`${part.kind}-${part.label}`} className="contents">
                  {index > 0 ? <span className="shrink-0">/</span> : null}
                  <span
                    className={cn(
                      'min-w-0 truncate',
                      part.kind === 'path'
                        ? isInline
                          ? 'max-w-[280px]'
                          : 'max-w-[420px]'
                        : isInline
                          ? 'max-w-[120px]'
                          : 'max-w-[180px]'
                    )}
                    title={part.label}
                  >
                    {part.label}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <span className="truncate text-xs text-low">
              {t('projectWorkspaceDefault.empty', {
                defaultValue: 'Not configured',
              })}
            </span>
          )}
        </div>

        {isPanel ? (
          <p className="mt-half text-xs leading-relaxed text-low">
            {defaultContextQuery.isError
              ? t('projectWorkspaceDefault.loadFailedDescription', {
                  defaultValue:
                    'The saved working location could not be resolved. Open project settings to review it.',
                })
              : isConfigured
                ? t('projectWorkspaceDefault.description', {
                    defaultValue:
                      'This path and branch will prefill new executions. You still confirm the actual workspace before an agent starts.',
                  })
                : t('projectWorkspaceDefault.emptyDescription', {
                    defaultValue:
                      'No hidden fallback will be used. Choose a path and branch when starting an execution, or configure a project default.',
                  })}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => void openConfiguration()}
        className={cn(
          'flex shrink-0 cursor-pointer items-center gap-half rounded-sm text-xs font-medium',
          isInline ? 'size-7 justify-center p-0' : 'min-h-9 px-base',
          'text-normal transition-colors hover:bg-secondary hover:text-high',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand'
        )}
        aria-label={t('projectWorkspaceDefault.configure', {
          defaultValue: 'Configure project working location',
        })}
      >
        <Settings2 className="size-icon-xs" aria-hidden="true" />
        {!isInline
          ? t('projectWorkspaceDefault.configureShort', {
              defaultValue: 'Configure',
            })
          : null}
      </button>
    </section>
  );
}
