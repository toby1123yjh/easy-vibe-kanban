import { create, useModal } from '@ebay/nice-modal-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Loader2, Play, Trash2 } from 'lucide-react';
import { Button } from '@vibe/ui/components/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@vibe/ui/components/KeyboardDialog';
import { Input } from '@vibe/ui/components/Input';
import { Switch } from '@vibe/ui/components/Switch';
import { Textarea } from '@vibe/ui/components/Textarea';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { defineModal } from '@/shared/lib/modals';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useScheduledTaskMutations } from '@/shared/hooks/useScheduledTasks';
import { ProjectProvider } from '@/shared/providers/remote/ProjectProvider';
import { buildWorkflowRunInput } from '../model/issueWorkflow';
import {
  formatScheduledTaskDateTime,
  getScheduledTaskStatusKey,
  getScheduledTaskWeekdayKey,
  SCHEDULED_TASK_TIMEZONES,
  SCHEDULED_TASK_WEEKDAYS,
} from '../model/scheduledTaskPresentation';
import type {
  ScheduledTaskKind,
  ScheduledTaskResponse,
  UpsertScheduledTaskRequest,
} from 'shared/types';

export interface ScheduledTaskDialogProps {
  projectId: string;
  workflowId: string;
  workflowName: string;
  existingTask?: ScheduledTaskResponse | null;
}

export type ScheduledTaskDialogResult =
  | { kind: 'saved'; taskId: string }
  | { kind: 'deleted' }
  | { kind: 'run'; taskId: string; runId: string }
  | { kind: 'canceled' };

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return fallback;
}

const fieldLabelClassName = 'text-xs font-medium text-low';
const nativeSelectClassName =
  'h-10 w-full rounded border border-secondary bg-secondary px-2 text-sm text-normal outline-none focus:border-brand disabled:cursor-not-allowed disabled:opacity-50';

function ScheduledTaskDialogContent({
  projectId,
  workflowId,
  workflowName,
  existingTask = null,
}: ScheduledTaskDialogProps) {
  const { t } = useTranslation('common');
  const modal = useModal();
  const navigation = useAppNavigation();
  const { issues, getIssue } = useProjectContext();
  const {
    upsertTask,
    deleteTask,
    runNow,
    isUpsertingTask,
    isDeletingTask,
    isRunningNow,
  } = useScheduledTaskMutations();

  const initialIssueId = existingTask?.context_issue_id ?? issues[0]?.id ?? '';
  const initialIssue = initialIssueId ? getIssue(initialIssueId) : undefined;

  const [enabled, setEnabled] = useState(existingTask?.enabled ?? true);
  const [scheduleKind, setScheduleKind] = useState<ScheduledTaskKind>(
    existingTask?.schedule_kind ?? 'daily'
  );
  const [timeOfDay, setTimeOfDay] = useState(
    existingTask?.time_of_day ?? '09:00'
  );
  const [weekday, setWeekday] = useState(String(existingTask?.weekday ?? 1));
  const [timezone, setTimezone] = useState(
    existingTask?.timezone ?? 'Asia/Shanghai'
  );
  const [contextIssueId, setContextIssueId] = useState(initialIssueId);
  const [inputText, setInputText] = useState(
    () =>
      existingTask?.input_text ??
      buildWorkflowRunInput({
        title: initialIssue?.title ?? workflowName,
        description: initialIssue?.description,
      })
  );
  const [inputTouched, setInputTouched] = useState(Boolean(existingTask));
  const [error, setError] = useState<string | null>(null);

  const selectedIssue = useMemo(
    () => (contextIssueId ? getIssue(contextIssueId) : undefined),
    [contextIssueId, getIssue]
  );

  useEffect(() => {
    if (contextIssueId || issues.length === 0) return;

    const firstIssue = issues[0];
    setContextIssueId(firstIssue.id);
    if (!existingTask && !inputTouched) {
      setInputText(
        buildWorkflowRunInput({
          title: firstIssue.title,
          description: firstIssue.description,
        })
      );
    }
  }, [contextIssueId, existingTask, inputTouched, issues]);

  const isBusy = isUpsertingTask || isDeletingTask || isRunningNow;
  const hasIssues = issues.length > 0;

  const handleCancel = () => {
    modal.resolve({
      kind: 'canceled',
    } satisfies ScheduledTaskDialogResult);
    modal.hide();
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      handleCancel();
    }
  };

  const handleIssueChange = (issueId: string) => {
    setContextIssueId(issueId);
    const issue = getIssue(issueId);
    if (!existingTask && !inputTouched && issue) {
      setInputText(
        buildWorkflowRunInput({
          title: issue.title,
          description: issue.description,
        })
      );
    }
  };

  const validateForm = (): boolean => {
    if (!contextIssueId) {
      setError(t('workflow.schedule.errors.issueRequired'));
      return false;
    }
    if (!timeOfDay || !/^\d{2}:\d{2}$/.test(timeOfDay)) {
      setError(t('workflow.schedule.errors.timeRequired'));
      return false;
    }
    if (scheduleKind === 'weekly' && !weekday) {
      setError(t('workflow.schedule.errors.weekdayRequired'));
      return false;
    }
    if (!inputText.trim()) {
      setError(t('workflow.schedule.errors.inputRequired'));
      return false;
    }
    setError(null);
    return true;
  };

  const saveTask = async (): Promise<ScheduledTaskResponse | null> => {
    if (!validateForm()) return null;

    const payload: UpsertScheduledTaskRequest = {
      target_type: 'workflow',
      target_id: workflowId,
      context_issue_id: contextIssueId,
      name: workflowName,
      enabled,
      schedule_kind: scheduleKind,
      time_of_day: timeOfDay,
      timezone,
      input_text: inputText.trim(),
    };
    if (scheduleKind === 'weekly') {
      payload.weekday = Number(weekday);
    }

    return upsertTask({ projectId, payload });
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const task = await saveTask();
      if (!task) return;
      modal.resolve({
        kind: 'saved',
        taskId: task.id,
      } satisfies ScheduledTaskDialogResult);
      modal.hide();
    } catch (err) {
      setError(getErrorMessage(err, t('workflow.schedule.errors.saveFailed')));
    }
  };

  const handleRunNow = async () => {
    try {
      const task = await saveTask();
      if (!task) return;
      const result = await runNow(task.id);
      if (result.run) {
        modal.resolve({
          kind: 'run',
          taskId: result.task.id,
          runId: result.run.id,
        } satisfies ScheduledTaskDialogResult);
        modal.hide();
        navigation.goToProjectWorkflowRun(projectId, result.run.id);
        return;
      }
      setError(
        result.task.last_error || t('workflow.schedule.errors.runSkipped')
      );
    } catch (err) {
      setError(getErrorMessage(err, t('workflow.schedule.errors.runFailed')));
    }
  };

  const handleDelete = async () => {
    if (!existingTask) return;

    const result = await ConfirmDialog.show({
      title: t('workflow.schedule.deleteTitle'),
      message: t('workflow.schedule.deleteMessage'),
      confirmText: t('buttons.delete'),
      variant: 'destructive',
    });
    if (result !== 'confirmed') return;

    try {
      await deleteTask(existingTask);
      modal.resolve({
        kind: 'deleted',
      } satisfies ScheduledTaskDialogResult);
      modal.hide();
    } catch (err) {
      setError(
        getErrorMessage(err, t('workflow.schedule.errors.deleteFailed'))
      );
    }
  };

  const nextRunLabel = existingTask
    ? formatScheduledTaskDateTime(
        existingTask.next_run_at,
        timezone,
        t('workflow.schedule.none')
      )
    : t('workflow.schedule.none');
  const lastTriggeredLabel = existingTask
    ? formatScheduledTaskDateTime(
        existingTask.last_triggered_at,
        timezone,
        t('workflow.schedule.none')
      )
    : t('workflow.schedule.none');
  const lastStatusLabel = existingTask
    ? t(
        `workflow.schedule.status.${getScheduledTaskStatusKey(
          existingTask.last_status
        )}`
      )
    : t('workflow.schedule.status.idle');

  return (
    <Dialog open={modal.visible} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-4rem)] overflow-hidden sm:max-w-[640px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-brand" />
            <DialogTitle>{t('workflow.schedule.title')}</DialogTitle>
          </div>
          <DialogDescription>
            {t('workflow.schedule.description')}
          </DialogDescription>
        </DialogHeader>

        <form className="flex min-h-0 flex-col gap-base" onSubmit={handleSave}>
          <div className="min-h-0 space-y-base overflow-y-auto pr-1">
            <section className="rounded-sm border border-secondary bg-panel p-base">
              <div className="flex items-start justify-between gap-base">
                <div className="min-w-0">
                  <div className="text-xs font-medium text-low">
                    {t('workflow.schedule.target')}
                  </div>
                  <div className="mt-1 truncate text-sm font-medium text-high">
                    {workflowName || t('workflow.templates.untitled')}
                  </div>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-sm text-normal">
                  <Switch
                    checked={enabled}
                    onCheckedChange={setEnabled}
                    disabled={isBusy}
                    aria-label={t('workflow.schedule.enabled')}
                  />
                  {enabled
                    ? t('workflow.schedule.enabled')
                    : t('workflow.schedule.paused')}
                </label>
              </div>

              <div className="mt-base grid gap-half text-xs text-low sm:grid-cols-3">
                <div>
                  <div>{t('workflow.schedule.nextRun')}</div>
                  <div className="mt-0.5 text-normal">{nextRunLabel}</div>
                </div>
                <div>
                  <div>{t('workflow.schedule.lastTriggered')}</div>
                  <div className="mt-0.5 text-normal">{lastTriggeredLabel}</div>
                </div>
                <div>
                  <div>{t('workflow.schedule.lastStatus')}</div>
                  <div className="mt-0.5 text-normal">{lastStatusLabel}</div>
                </div>
              </div>

              {existingTask?.last_error ? (
                <div className="mt-base rounded-sm border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
                  {existingTask.last_error}
                </div>
              ) : null}
            </section>

            <section className="grid gap-base sm:grid-cols-2">
              <div className="flex flex-col gap-half">
                <label className={fieldLabelClassName} htmlFor="schedule-kind">
                  {t('workflow.schedule.frequency')}
                </label>
                <select
                  id="schedule-kind"
                  className={nativeSelectClassName}
                  value={scheduleKind}
                  onChange={(event) =>
                    setScheduleKind(event.target.value as ScheduledTaskKind)
                  }
                  disabled={isBusy}
                >
                  <option value="daily">{t('workflow.schedule.daily')}</option>
                  <option value="weekly">
                    {t('workflow.schedule.weekly')}
                  </option>
                </select>
              </div>

              <div className="flex flex-col gap-half">
                <label className={fieldLabelClassName} htmlFor="schedule-time">
                  {t('workflow.schedule.time')}
                </label>
                <Input
                  id="schedule-time"
                  type="time"
                  value={timeOfDay}
                  onChange={(event) => setTimeOfDay(event.target.value)}
                  disabled={isBusy}
                  className="rounded border-secondary bg-secondary"
                />
              </div>

              {scheduleKind === 'weekly' ? (
                <div className="flex flex-col gap-half">
                  <label
                    className={fieldLabelClassName}
                    htmlFor="schedule-weekday"
                  >
                    {t('workflow.schedule.weekday')}
                  </label>
                  <select
                    id="schedule-weekday"
                    className={nativeSelectClassName}
                    value={weekday}
                    onChange={(event) => setWeekday(event.target.value)}
                    disabled={isBusy}
                  >
                    {SCHEDULED_TASK_WEEKDAYS.map((day) => (
                      <option key={day} value={String(day)}>
                        {t(
                          `workflow.schedule.weekdays.${getScheduledTaskWeekdayKey(
                            day
                          )}`
                        )}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="flex flex-col gap-half">
                <label
                  className={fieldLabelClassName}
                  htmlFor="schedule-timezone"
                >
                  {t('workflow.schedule.timezone')}
                </label>
                <select
                  id="schedule-timezone"
                  className={nativeSelectClassName}
                  value={timezone}
                  onChange={(event) => setTimezone(event.target.value)}
                  disabled={isBusy}
                >
                  {SCHEDULED_TASK_TIMEZONES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <section className="flex flex-col gap-base">
              <div className="flex flex-col gap-half">
                <label className={fieldLabelClassName} htmlFor="schedule-issue">
                  {t('workflow.schedule.contextIssue')}
                </label>
                <select
                  id="schedule-issue"
                  className={nativeSelectClassName}
                  value={contextIssueId}
                  onChange={(event) => handleIssueChange(event.target.value)}
                  disabled={isBusy || !hasIssues}
                >
                  {hasIssues ? (
                    issues.map((issue) => (
                      <option key={issue.id} value={issue.id}>
                        {issue.simple_id
                          ? `${issue.simple_id} - ${issue.title}`
                          : issue.title}
                      </option>
                    ))
                  ) : (
                    <option value="">{t('workflow.schedule.noIssue')}</option>
                  )}
                </select>
              </div>

              <div className="flex flex-col gap-half">
                <label className={fieldLabelClassName} htmlFor="schedule-input">
                  {t('workflow.schedule.inputText')}
                </label>
                <Textarea
                  id="schedule-input"
                  value={inputText}
                  onChange={(event) => {
                    setInputTouched(true);
                    setInputText(event.target.value);
                  }}
                  rows={6}
                  disabled={isBusy}
                  className="font-ibm-plex-mono"
                  placeholder={
                    selectedIssue
                      ? buildWorkflowRunInput({
                          title: selectedIssue.title,
                          description: selectedIssue.description,
                        })
                      : t('workflow.schedule.inputPlaceholder')
                  }
                />
              </div>
            </section>

            {error ? (
              <p className="text-xs text-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter className="shrink-0 sm:!justify-between">
            <div>
              {existingTask ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void handleDelete()}
                  disabled={isBusy}
                  className="flex items-center gap-2"
                >
                  {isDeletingTask ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  {t('workflow.schedule.delete')}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isBusy}
              >
                {t('buttons.cancel')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleRunNow()}
                disabled={isBusy || !hasIssues}
                className="flex items-center gap-2"
              >
                {isRunningNow ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {t('workflow.schedule.runNow')}
              </Button>
              <Button
                type="submit"
                disabled={isBusy || !hasIssues}
                className="flex items-center gap-2"
              >
                {isUpsertingTask ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                {t('workflow.schedule.save')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const ScheduledTaskDialogImpl = create<ScheduledTaskDialogProps>((props) => {
  return (
    <ProjectProvider projectId={props.projectId}>
      <ScheduledTaskDialogContent {...props} />
    </ProjectProvider>
  );
});

export const ScheduledTaskDialog = defineModal<
  ScheduledTaskDialogProps,
  ScheduledTaskDialogResult
>(ScheduledTaskDialogImpl);
