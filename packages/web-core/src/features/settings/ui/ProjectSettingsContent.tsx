import { useTranslation } from 'react-i18next';
import { Button } from '@vibe/ui/components/Button';
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from '@vibe/ui/components/StateSurface';
import { useProjectSettingsRecord } from '@/shared/hooks/useProjectSettingsRecord';
import { RemoteProjectsSettingsSection } from '@/shared/dialogs/settings/settings/RemoteProjectsSettingsSection';

export function ProjectSettingsContent({ projectId }: { projectId: string }) {
  const { t } = useTranslation(['projects', 'common']);
  const project = useProjectSettingsRecord(projectId);
  if (project.isPending)
    return <LoadingState title={t('common:states.loading')} />;
  if (project.isError)
    return (
      <ErrorState
        title={t('scoped.loadError', 'Could not load project settings')}
        action={
          <Button
            disabled={project.isFetching}
            onClick={() => void project.refetch()}
          >
            {t('common:buttons.retry')}
          </Button>
        }
      />
    );
  if (!project.data)
    return <EmptyState title={t('scoped.notFound', 'Project not found')} />;
  return (
    <RemoteProjectsSettingsSection
      key={projectId}
      scoped
      initialState={{ organizationId: project.data.organization_id, projectId }}
    />
  );
}
