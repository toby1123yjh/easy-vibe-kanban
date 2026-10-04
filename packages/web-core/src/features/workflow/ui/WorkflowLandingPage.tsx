import { useTranslation } from 'react-i18next';
import { Button } from '@vibe/ui/components/Button';
import { ErrorState, LoadingState } from '@vibe/ui/components/StateSurface';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@vibe/ui/components/Select';
import { useAppShellProjects } from '@/shared/hooks/useAppShellProjects';
import { WorkflowTemplateListPage } from './WorkflowTemplateListPage';

interface WorkflowLandingPageProps {
  projectId?: string;
  onProjectChange: (projectId: string) => void;
}

/** The existing Workflow destination, with an explicit host-local project. */
export function WorkflowLandingPage({
  projectId,
  onProjectChange,
}: WorkflowLandingPageProps) {
  const { t } = useTranslation('common');
  const projects = useAppShellProjects();

  if (!projects || (projects.isLoading && !projects.items.length)) {
    return <LoadingState title={t('workflow.templates.title')} />;
  }

  if (projects.isError && !projects.items.length) {
    return (
      <ErrorState
        title={t('workflow.management.projectsFailed')}
        action={
          <Button
            variant="outline"
            loading={projects.isFetching}
            onClick={() => void projects.retry()}
          >
            {t('buttons.retry')}
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-primary">
      <div className="flex shrink-0 flex-wrap items-center gap-base border-b border-secondary p-base">
        <label htmlFor="workflow-project" className="text-base text-normal">
          {t('workflow.management.project')}
        </label>
        <Select value={projectId ?? ''} onValueChange={onProjectChange}>
          <SelectTrigger
            id="workflow-project"
            className="h-9 w-64 max-w-full rounded-md border-secondary text-base"
          >
            <SelectValue placeholder={t('workflow.management.chooseProject')} />
          </SelectTrigger>
          <SelectContent>
            {projects.items.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
            {projectId && !projects.items.some((p) => p.id === projectId) ? (
              <SelectItem value={projectId}>{projectId}</SelectItem>
            ) : null}
          </SelectContent>
        </Select>
        {projects.hasNextPage || projects.isFetchNextPageError ? (
          <Button
            variant="ghost"
            size="sm"
            loading={projects.isFetchingNextPage}
            onClick={() => void projects.loadNextPage()}
          >
            {t('workflow.management.moreProjects')}
          </Button>
        ) : null}
        {projects.isError ? (
          <Button
            variant="ghost"
            size="sm"
            loading={projects.isFetching}
            onClick={() => void projects.retry()}
          >
            {t('buttons.retry')}
          </Button>
        ) : null}
      </div>
      {projectId ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <WorkflowTemplateListPage key={projectId} projectId={projectId} />
        </div>
      ) : (
        <p className="p-double text-base text-low">
          {t('workflow.management.chooseProjectHint')}
        </p>
      )}
    </div>
  );
}
