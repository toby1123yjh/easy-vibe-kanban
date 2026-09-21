import i18n from '@/i18n/config';

export function formatLocalizedDateTime(
  value: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(i18n.resolvedLanguage || 'en', options);
}

/**
 * Format a date string as "Jan 5, 10:30 AM".
 */
export function formatDateShortWithTime(dateString: string): string {
  return formatLocalizedDateTime(dateString, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a date string as a relative time (e.g., "just now", "5m ago", "2h ago", "3d ago").
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.trunc(diffMs / 1000);
  const diffMins = Math.trunc(diffSecs / 60);
  const diffHours = Math.trunc(diffMins / 60);
  const diffDays = Math.trunc(diffHours / 24);

  const formatter = new Intl.RelativeTimeFormat(i18n.resolvedLanguage || 'en', {
    numeric: 'auto',
  });
  if (Math.abs(diffSecs) < 60) return formatter.format(0, 'second');
  if (Math.abs(diffMins) < 60) return formatter.format(-diffMins, 'minute');
  if (Math.abs(diffHours) < 24) return formatter.format(-diffHours, 'hour');
  return formatter.format(-diffDays, 'day');
}
