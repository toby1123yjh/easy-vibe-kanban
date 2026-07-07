import type { TFunction } from 'i18next';
import type {
  ScheduledTaskKind,
  ScheduledTaskLastStatus,
  ScheduledTaskResponse,
} from 'shared/types';

export const SCHEDULED_TASK_TIMEZONES = [
  'UTC',
  'Etc/UTC',
  'Asia/Shanghai',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
] as const;

export const SCHEDULED_TASK_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export function getScheduledTaskStatusKey(status: ScheduledTaskLastStatus) {
  switch (status) {
    case 'awaiting_human':
      return 'awaitingHuman';
    case 'awaiting_arena':
      return 'awaitingArena';
    default:
      return status;
  }
}

export function getScheduledTaskWeekdayKey(weekday: number | null | undefined) {
  switch (weekday) {
    case 1:
      return 'monday';
    case 2:
      return 'tuesday';
    case 3:
      return 'wednesday';
    case 4:
      return 'thursday';
    case 5:
      return 'friday';
    case 6:
      return 'saturday';
    default:
      return 'sunday';
  }
}

export function getScheduledTaskSummary(
  task: ScheduledTaskResponse | null | undefined,
  t: TFunction<'common'>
): string {
  if (!task) {
    return t('workflow.schedule.summaryUnset');
  }

  if (!task.enabled) {
    return t('workflow.schedule.summaryPaused');
  }

  if (task.last_status === 'failed') {
    return t('workflow.schedule.summaryFailed');
  }

  return getScheduledTaskScheduleLabel(task, t);
}

export function getScheduledTaskScheduleLabel(
  task: Pick<
    ScheduledTaskResponse,
    'schedule_kind' | 'time_of_day' | 'weekday'
  >,
  t: TFunction<'common'>
): string {
  return getScheduleLabel(
    task.schedule_kind,
    task.time_of_day,
    task.weekday,
    t
  );
}

export function getScheduleLabel(
  scheduleKind: ScheduledTaskKind,
  timeOfDay: string,
  weekday: number | null | undefined,
  t: TFunction<'common'>
): string {
  if (scheduleKind === 'weekly') {
    return t('workflow.schedule.summaryWeekly', {
      weekday: t(
        `workflow.schedule.weekdays.${getScheduledTaskWeekdayKey(weekday)}`
      ),
      time: timeOfDay,
    });
  }

  return t('workflow.schedule.summaryDaily', {
    time: timeOfDay,
  });
}

export function formatScheduledTaskDateTime(
  value: string | null | undefined,
  timezone: string,
  fallback: string
): string {
  if (!value) return fallback;

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone || 'UTC',
    }).format(new Date(value));
  } catch {
    return new Date(value).toLocaleString();
  }
}
