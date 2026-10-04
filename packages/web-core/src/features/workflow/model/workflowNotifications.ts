import type { WorkflowNotificationView } from 'shared/types';
import type { PatchTypeWithKey } from '@/shared/hooks/useConversationHistory/types';

export interface WorkflowNotificationCopy {
  heading: string;
  resolved: string;
  pending: string;
  status: (status: string) => string;
}

/** Runtime facts are system messages, never fabricated Agent events or replies. */
export function workflowNotificationEntries(
  notifications: readonly WorkflowNotificationView[],
  sessionId: string,
  copy: WorkflowNotificationCopy
): PatchTypeWithKey[] {
  const unique = new Map<string, WorkflowNotificationView>();
  for (const notification of notifications) {
    if (notification.main_session_id === sessionId) {
      unique.set(notification.id, notification);
    }
  }
  return [...unique.values()]
    .sort((left, right) =>
      left.sequence < right.sequence
        ? -1
        : left.sequence > right.sequence
          ? 1
          : 0
    )
    .map((notification) => {
      const interaction = notification.interaction_id
        ? notification.is_resolved
          ? copy.resolved
          : copy.pending
        : null;
      return {
        type: 'NORMALIZED_ENTRY',
        patchKey: `workflow-notification:${notification.id}`,
        content: {
          entry_type: { type: 'system_message' },
          content: [
            `${copy.heading} · ${copy.status(notification.current_status)}`,
            notification.summary,
            interaction,
          ]
            .filter(Boolean)
            .join('\n'),
          timestamp: notification.created_at,
        },
      };
    });
}

/** Preserve native event order; insert independent runtime facts by time. */
export function mergeWorkflowNotifications(
  entries: readonly PatchTypeWithKey[],
  notifications: readonly PatchTypeWithKey[]
): PatchTypeWithKey[] {
  const result: PatchTypeWithKey[] = [];
  let next = 0;
  for (const entry of entries) {
    const timestamp =
      entry.type === 'NORMALIZED_ENTRY' ? entry.content.timestamp : null;
    if (timestamp) {
      const time = Date.parse(timestamp);
      while (next < notifications.length) {
        const notification = notifications[next];
        const notificationTime =
          notification.type === 'NORMALIZED_ENTRY'
            ? Date.parse(notification.content.timestamp ?? '')
            : NaN;
        if (!Number.isFinite(time) || notificationTime > time) break;
        result.push(notification);
        next += 1;
      }
    }
    result.push(entry);
  }
  return result.concat(notifications.slice(next));
}
