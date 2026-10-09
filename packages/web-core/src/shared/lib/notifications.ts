import type {
  Notification,
  NotificationGroupKind,
  NotificationPayload,
  NotificationType,
} from 'shared/remote-types';

const GROUP_WINDOW_MS = 5 * 60 * 1000;

export function getPayload(n: Notification): NotificationPayload {
  return n.payload ?? {};
}

export function getDeeplinkPath(n: Notification): string | null {
  return normalizeTaskDeeplink(getPayload(n).deeplink_path);
}

/** Persisted notification links remain usable after the business rename. */
export function normalizeTaskDeeplink(
  path: string | null | undefined
): string | null {
  return (
    path?.replace(/^(\/projects\/[^/?#]+)\/issues(?=\/)/, '$1/tasks') ?? null
  );
}

type TaskChangeField =
  | 'title'
  | 'description'
  | 'priority'
  | 'assignee'
  | 'unassigned';

type GroupableNotificationKind = Exclude<NotificationGroupKind, 'single'>;

export type GroupedNotification = {
  id: string;
  kind: NotificationGroupKind;
  latest: Notification;
  seen: boolean;
  deeplinkPath: string | null;
  notificationCount: number;
  unseenNotificationIds: string[];
  taskChangeCount: number;
};

type NotificationGroupingMeta = {
  groupKind: GroupableNotificationKind;
  taskChangeField?: TaskChangeField;
  scope: 'task' | 'project';
};

type GroupAccumulator = {
  id: string;
  kind: GroupableNotificationKind;
  notifications: Notification[];
  latest: Notification;
  taskChangeFields: Set<TaskChangeField>;
};

type ActiveGroup = {
  index: number;
  group: GroupAccumulator;
};

const NOTIFICATION_GROUPING_META: Partial<
  Record<NotificationType, NotificationGroupingMeta>
> = {
  task_title_changed: {
    groupKind: 'task_changes',
    taskChangeField: 'title',
    scope: 'task',
  },
  task_description_changed: {
    groupKind: 'task_changes',
    taskChangeField: 'description',
    scope: 'task',
  },
  task_priority_changed: {
    groupKind: 'task_changes',
    taskChangeField: 'priority',
    scope: 'task',
  },
  task_status_changed: {
    groupKind: 'status_changes',
    scope: 'task',
  },
  task_assignee_changed: {
    groupKind: 'task_changes',
    taskChangeField: 'assignee',
    scope: 'task',
  },
  task_unassigned: {
    groupKind: 'task_changes',
    taskChangeField: 'unassigned',
    scope: 'task',
  },
  task_comment_added: {
    groupKind: 'comments',
    scope: 'task',
  },
  task_comment_reaction: {
    groupKind: 'reactions',
    scope: 'task',
  },
  task_deleted: {
    groupKind: 'task_deleted',
    scope: 'project',
  },
};

function getGroupingMeta(
  notification: Notification
): NotificationGroupingMeta | null {
  return NOTIFICATION_GROUPING_META[notification.notification_type] ?? null;
}

function getGroupKey(
  notification: Notification,
  meta: NotificationGroupingMeta
): string | null {
  const payload = getPayload(notification);
  const actorId = payload.actor_user_id;

  if (!actorId) {
    return null;
  }

  if (meta.scope === 'project') {
    const projectPath = payload.deeplink_path;
    if (!projectPath) {
      return null;
    }
    return `${meta.groupKind}:${actorId}:${projectPath}`;
  }

  const taskId = payload.task_id ?? notification.task_id;
  if (!taskId) {
    return null;
  }

  return `${meta.groupKind}:${actorId}:${taskId}`;
}

function buildGroupedNotification(
  id: string,
  kind: NotificationGroupKind,
  latest: Notification,
  notifications: Notification[],
  taskChangeCount: number
): GroupedNotification {
  const unseenNotificationIds = notifications
    .filter((notification) => !notification.seen)
    .map((notification) => notification.id);

  return {
    id,
    kind,
    latest,
    seen: unseenNotificationIds.length === 0,
    deeplinkPath: getDeeplinkPath(latest),
    notificationCount: notifications.length,
    unseenNotificationIds,
    taskChangeCount,
  };
}

function buildSingleGroupedNotification(
  notification: Notification
): GroupedNotification {
  return buildGroupedNotification(
    notification.id,
    'single',
    notification,
    [notification],
    0
  );
}

function createAccumulator(
  notification: Notification,
  groupKey: string,
  meta: NotificationGroupingMeta
): GroupAccumulator {
  const taskChangeFields = new Set<TaskChangeField>();
  if (meta.taskChangeField) {
    taskChangeFields.add(meta.taskChangeField);
  }

  return {
    id: `${groupKey}:${notification.id}`,
    kind: meta.groupKind,
    notifications: [notification],
    latest: notification,
    taskChangeFields,
  };
}

function getCreatedAtTimestamp(notification: Notification): number {
  return new Date(notification.created_at).getTime();
}

function shouldStartNewGroup(
  group: GroupAccumulator,
  notification: Notification
): boolean {
  return (
    getCreatedAtTimestamp(group.latest) - getCreatedAtTimestamp(notification) >
    GROUP_WINDOW_MS
  );
}

function finalizeGroup(group: GroupAccumulator): GroupedNotification {
  return buildGroupedNotification(
    group.id,
    group.kind,
    group.latest,
    group.notifications,
    group.kind === 'task_changes' ? Math.max(group.taskChangeFields.size, 1) : 0
  );
}

function addNotificationToGroup(
  group: GroupAccumulator,
  notification: Notification,
  meta: NotificationGroupingMeta
) {
  group.notifications.push(notification);

  if (meta.taskChangeField) {
    group.taskChangeFields.add(meta.taskChangeField);
  }
}

export function groupNotifications(
  notifications: Notification[]
): GroupedNotification[] {
  const sorted = [...notifications].sort(
    (a, b) => getCreatedAtTimestamp(b) - getCreatedAtTimestamp(a)
  );
  const groups: GroupedNotification[] = [];
  const groupsByKey = new Map<string, ActiveGroup>();

  for (const notification of sorted) {
    const meta = getGroupingMeta(notification);
    if (!meta) {
      groups.push(buildSingleGroupedNotification(notification));
      continue;
    }

    const groupKey = getGroupKey(notification, meta);
    if (!groupKey) {
      groups.push(buildSingleGroupedNotification(notification));
      continue;
    }

    const activeGroup = groupsByKey.get(groupKey);
    if (!activeGroup || shouldStartNewGroup(activeGroup.group, notification)) {
      const nextGroup = createAccumulator(notification, groupKey, meta);
      const index = groups.length;
      groups.push(finalizeGroup(nextGroup));
      groupsByKey.set(groupKey, { index, group: nextGroup });
      continue;
    }

    addNotificationToGroup(activeGroup.group, notification, meta);
    groups[activeGroup.index] = finalizeGroup(activeGroup.group);
  }

  return groups;
}
