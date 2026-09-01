import {
  useWorkflowTemplates,
  useWorkflowTemplateMutations,
} from '@/shared/hooks/useWorkflowTemplates';
import { useScheduledTasks } from '@/shared/hooks/useScheduledTasks';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { createDefaultWorkflowGraph } from '../model/workflowGraph';
import { shouldShowWorkflowTemplate } from '../model/workflowTemplateVisibility';
import { getScheduledTaskSummary } from '../model/scheduledTaskPresentation';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { Button } from '@vibe/ui/components/Button';
import {
  DegradedState,
  EmptyState,
  ErrorState,
  LoadingState,
} from '@vibe/ui/components/StateSurface';
import {
  ArrowRight,
  CalendarClock,
  FileText,
  Loader2,
  Plus,
} from 'lucide-react';
import { getWorkflowDefaultGraphLabels } from './workflowI18n';
import { ScheduledTaskDialog } from './ScheduledTaskDialog';

export interface WorkflowTemplateListPageProps {
  projectId: string;
}

export function WorkflowTemplateListPage({
  projectId,
}: WorkflowTemplateListPageProps) {
  const { t } = useTranslation('common');
  const { data, isLoading, isFetching, error, refetch } =
    useWorkflowTemplates(projectId);
  const { data: scheduledTaskData } = useScheduledTasks(projectId, {
    target_type: 'workflow',
  });
  const { createTemplate, isCreating } = useWorkflowTemplateMutations();
  const navigation = useAppNavigation();

  const handleCreate = async () => {
    const defaultGraph = createDefaultWorkflowGraph(
      getWorkflowDefaultGraphLabels(t)
    );
    const result = await createTemplate({
      projectId,
      payload: {
        name: t('workflow.templates.newWorkflowName'),
        description: '',
        graph_json: JSON.stringify(defaultGraph),
      },
    });
    navigation.goToProjectWorkflowEdit(projectId, result.id);
  };

  const handleOpen = (workflowId: string) => {
    navigation.goToProjectWorkflowEdit(projectId, workflowId);
  };

  const scheduledTaskByWorkflowId = useMemo(
    () =>
      new Map(
        (scheduledTaskData?.tasks ?? []).map((task) => [task.target_id, task])
      ),
    [scheduledTaskData]
  );

  if (isLoading) {
    return (
      <LoadingState
        className="h-full w-full bg-primary"
        title={t('workflow.templates.title')}
      />
    );
  }

  if (error && !data) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <ErrorState
        className="h-full w-full bg-primary"
        title={t('workflow.templates.loadFailed', { message })}
        action={
          <Button
            type="button"
            variant="outline"
            loading={isFetching}
            onClick={() => void refetch()}
          >
            {t('buttons.retry')}
          </Button>
        }
      />
    );
  }

  const templates = (data?.workflows ?? []).filter(shouldShowWorkflowTemplate);

  return (
    <div className="flex h-full flex-col bg-primary p-base">
      <div className="mb-base flex items-center justify-between">
        <h1 className="text-xl font-semibold text-high">
          {t('workflow.templates.title')}
        </h1>
        <Button
          onClick={handleCreate}
          disabled={isCreating}
          className="flex items-center gap-2"
        >
          {isCreating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          {t('workflow.templates.newCanvas')}
        </Button>
      </div>

      {error ? (
        <DegradedState
          compact
          className="mb-base shrink-0 border border-warning/30"
          title={t('workflow.templates.loadFailed', {
            message: error instanceof Error ? error.message : String(error),
          })}
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              loading={isFetching}
              onClick={() => void refetch()}
            >
              {t('buttons.retry')}
            </Button>
          }
        />
      ) : null}

      {templates.length === 0 ? (
        <EmptyState
          className="flex-1 rounded-lg border border-secondary bg-panel shadow-sm"
          title={t('workflow.templates.emptyTitle')}
          description={t('workflow.templates.emptyDescription')}
          action={
            <Button
              type="button"
              loading={isCreating}
              onClick={() => void handleCreate()}
            >
              {t('workflow.templates.createCanvas')}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => {
            const scheduledTask =
              scheduledTaskByWorkflowId.get(template.id) ?? null;
            const workflowName =
              template.name || t('workflow.templates.untitled');

            return (
              <div
                role="button"
                tabIndex={0}
                key={template.id}
                className="group flex min-h-[172px] cursor-pointer flex-col gap-3 rounded-lg border border-secondary bg-panel p-4 text-left shadow-sm transition-all duration-200 hover:border-brand hover:shadow-md focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                onClick={() => handleOpen(template.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    handleOpen(template.id);
                  }
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-secondary bg-primary shadow-sm">
                      <FileText className="h-4 w-4 text-brand" />
                    </div>
                    <h3 className="truncate text-sm font-semibold text-high">
                      {workflowName}
                    </h3>
                  </div>
                  <span
                    className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      template.source === 'system'
                        ? 'border-secondary bg-secondary/40 text-normal'
                        : 'border-brand/30 bg-brand/10 text-brand'
                    }`}
                  >
                    {template.source}
                  </span>
                </div>

                <p className="line-clamp-2 text-sm text-low">
                  {template.description ||
                    t('workflow.templates.noDescription')}
                </p>

                <div className="mt-auto flex items-center justify-between gap-3 rounded-sm border border-secondary/60 bg-secondary/20 px-2 py-1.5 text-xs text-low">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <CalendarClock className="h-3.5 w-3.5 shrink-0 text-brand" />
                    <span className="truncate">
                      {t('workflow.schedule.summaryPrefix', {
                        summary: getScheduledTaskSummary(scheduledTask, t),
                      })}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="h-7 shrink-0 px-2 text-xs text-brand hover:bg-brand/10"
                    onClick={(event) => {
                      event.stopPropagation();
                      void ScheduledTaskDialog.show({
                        projectId,
                        workflowId: template.id,
                        workflowName,
                        existingTask: scheduledTask,
                      });
                    }}
                  >
                    {t('workflow.schedule.button')}
                  </Button>
                </div>

                <div className="flex items-center justify-between border-t border-secondary/50 pt-3 text-xs text-low">
                  <span>
                    {t('workflow.templates.updated', {
                      date: new Date(template.updated_at).toLocaleDateString(),
                    })}
                  </span>
                  <span className="text-brand">
                    {t('workflow.templates.openCanvas')}
                  </span>
                  <ArrowRight className="h-4 w-4 text-brand opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
