import { useCallback, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { CheckIcon, ChecksIcon } from '@phosphor-icons/react';
import { UserAvatar } from '@vibe/ui/components/UserAvatar';
import { Button } from '@vibe/ui/components/Button';
import {
  DegradedState,
  EmptyState,
  ErrorState,
  LoadingState,
  PermissionState,
} from '@vibe/ui/components/StateSurface';
import { useNotifications } from '@/shared/hooks/useNotifications';
import { useNotificationMembers } from '@/shared/hooks/useNotificationMembers';
import type { GroupedNotification } from '@/shared/lib/notifications';
import {
  getGroupedNotificationSegments,
  getGroupedNotificationAccessibleText,
  type MessageSegment,
} from '@/shared/lib/notificationMessage';
import { formatRelativeTime } from '@/shared/lib/date';
import { cn } from '@/shared/lib/utils';
import { OAuthDialog } from '@/shared/dialogs/global/OAuthDialog';
import { projectUtilityCollectionState } from '@/features/utility/model/utilityState';
import { useAuth } from '@/shared/hooks/auth/useAuth';

type SeenUpdate = { id: string; changes: { seen: boolean } };

interface FailedSeenUpdate {
  scopeEpoch: number;
  updates: SeenUpdate[];
}

function NotificationMessage({
  segments,
  membersByUserId,
}: {
  segments: MessageSegment[];
  membersByUserId: ReturnType<typeof useNotificationMembers>['membersByUserId'];
}) {
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <span key={i}>{seg.value}</span>;
        if (seg.type === 'emphasis') {
          return (
            <span key={i} className="font-medium text-high">
              {seg.value}
            </span>
          );
        }
        if (seg.type === 'issue') {
          return (
            <span
              key={i}
              className="font-ibm-plex-mono text-high text-[0.95em]"
            >
              {seg.value}
            </span>
          );
        }
        const member = membersByUserId.get(seg.userId);
        if (member) {
          return (
            <UserAvatar
              key={i}
              user={member}
              className="inline-flex h-5 w-5 align-text-bottom text-[10px]"
            />
          );
        }
        return <span key={i}>Someone</span>;
      })}
    </>
  );
}

export function NotificationsPage() {
  const router = useRouter();
  const { isLoaded: isAuthLoaded, userId } = useAuth();
  const {
    data,
    updateMany,
    enabled,
    unseenCount,
    groupedNotifications,
    isLoading,
    error,
    retry,
  } = useNotifications();
  const {
    membersByUserId,
    isError: membersError,
    retry: retryMembers,
  } = useNotificationMembers(data);
  const notificationScopeRef = useRef({ userId, epoch: 0 });
  if (notificationScopeRef.current.userId !== userId) {
    notificationScopeRef.current = {
      userId,
      epoch: notificationScopeRef.current.epoch + 1,
    };
  }
  const scopeEpoch = notificationScopeRef.current.epoch;
  const [updatingScopeEpoch, setUpdatingScopeEpoch] = useState<number | null>(
    null
  );
  const [failedUpdate, setFailedUpdate] = useState<FailedSeenUpdate | null>(
    null
  );
  const updateLockRef = useRef<number | null>(null);
  const isUpdating = updatingScopeEpoch === scopeEpoch;
  const actionError = failedUpdate?.scopeEpoch === scopeEpoch;

  const collectionState = projectUtilityCollectionState({
    hasItems: groupedNotifications.length > 0,
    isLoading,
    error,
  });

  const persistUpdates = useCallback(
    async (updates: SeenUpdate[]) => {
      const mutationScopeEpoch = notificationScopeRef.current.epoch;
      if (
        updates.length === 0 ||
        error ||
        updateLockRef.current === mutationScopeEpoch
      ) {
        return;
      }

      updateLockRef.current = mutationScopeEpoch;
      setUpdatingScopeEpoch(mutationScopeEpoch);
      setFailedUpdate(null);

      try {
        await updateMany(updates).persisted;
      } catch {
        if (notificationScopeRef.current.epoch === mutationScopeEpoch) {
          setFailedUpdate({ scopeEpoch: mutationScopeEpoch, updates });
        }
      } finally {
        if (updateLockRef.current === mutationScopeEpoch) {
          updateLockRef.current = null;
        }
        if (notificationScopeRef.current.epoch === mutationScopeEpoch) {
          setUpdatingScopeEpoch(null);
        }
      }
    },
    [error, updateMany]
  );

  const markGroupSeen = useCallback(
    (group: GroupedNotification) => {
      if (group.unseenNotificationIds.length === 0) {
        return;
      }

      void persistUpdates(
        group.unseenNotificationIds.map((notificationId) => ({
          id: notificationId,
          changes: { seen: true },
        }))
      );
    },
    [persistUpdates]
  );

  const handleClick = useCallback(
    (group: GroupedNotification) => {
      markGroupSeen(group);
      const path = group.deeplinkPath;
      if (path) {
        router.navigate({ to: path as '/' });
      }
    },
    [markGroupSeen, router]
  );

  const handleMarkAllSeen = useCallback(() => {
    const unseen = data.filter((n) => !n.seen);
    if (unseen.length === 0) return;
    void persistUpdates(
      unseen.map((notification) => ({
        id: notification.id,
        changes: { seen: true },
      }))
    );
  }, [data, persistUpdates]);

  const handleRetryRead = useCallback(() => {
    retry();
    if (membersError) void retryMembers();
  }, [membersError, retry, retryMembers]);

  const handleRetryAction = useCallback(() => {
    if (failedUpdate?.scopeEpoch === notificationScopeRef.current.epoch) {
      void persistUpdates(failedUpdate.updates);
    }
  }, [failedUpdate, persistUpdates]);

  if (!isAuthLoaded) {
    return (
      <LoadingState
        className="h-full w-full bg-primary"
        title="Loading notification access…"
      />
    );
  }

  if (!enabled) {
    return (
      <PermissionState
        className="h-full w-full bg-primary"
        title="Sign in to view notifications"
        description="Notifications are tied to your cloud account."
        action={
          <Button
            className="min-h-11 sm:min-h-8"
            variant="outline"
            onClick={() => void OAuthDialog.show({})}
          >
            Sign in
          </Button>
        }
      />
    );
  }

  if (collectionState === 'loading') {
    return (
      <LoadingState
        className="h-full w-full bg-primary"
        title="Loading notifications…"
      />
    );
  }

  if (collectionState === 'error') {
    return (
      <ErrorState
        className="h-full w-full bg-primary"
        title="Notifications could not be loaded"
        description="The notification sync failed before any notifications were available."
        action={
          <Button
            className="min-h-11 sm:min-h-8"
            variant="outline"
            onClick={handleRetryRead}
          >
            Retry
          </Button>
        }
      />
    );
  }

  if (collectionState === 'empty') {
    return (
      <EmptyState
        className="h-full w-full bg-primary"
        title="No notifications yet"
        description="Updates you follow will appear here."
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-double py-base border-b border-border">
        <h1 className="text-xl font-medium text-high">Notifications</h1>
        {unseenCount > 0 && (
          <button
            type="button"
            disabled={Boolean(error) || isUpdating}
            onClick={handleMarkAllSeen}
            className="flex min-h-11 items-center gap-1 px-base py-half text-sm text-low hover:text-normal transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-8"
          >
            <ChecksIcon size={16} />
            Mark all as read
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {(collectionState === 'degraded' || membersError) && (
          <DegradedState
            compact
            title="Notifications may be out of date"
            description="The last available notifications remain visible while sync recovers."
            action={
              <Button
                className="min-h-11 sm:min-h-8"
                variant="outline"
                onClick={handleRetryRead}
              >
                Retry
              </Button>
            }
          />
        )}

        {actionError && (
          <ErrorState
            compact
            title="Notification changes were not saved"
            description="The notification list is unchanged on the server."
            action={
              <Button
                className="min-h-11 sm:min-h-8"
                variant="outline"
                loading={isUpdating}
                loadingLabel="Retrying notification changes"
                onClick={handleRetryAction}
              >
                Try again
              </Button>
            }
          />
        )}

        <div className="divide-y divide-border">
          {groupedNotifications.map((group) => {
            const summary = getGroupedNotificationAccessibleText(
              group,
              membersByUserId
            );
            return (
              <div
                key={group.id}
                className={cn(
                  'w-full flex items-center gap-base px-double py-base text-left transition-colors',
                  'hover:bg-secondary',
                  !group.seen && 'bg-brand/5'
                )}
              >
                <span
                  className={cn(
                    'shrink-0 w-2 h-2 rounded-full',
                    !group.seen && 'bg-brand'
                  )}
                />
                <button
                  type="button"
                  onClick={() => handleClick(group)}
                  className="min-w-0 flex-1 text-left outline-none focus-visible:rounded-sm focus-visible:ring-1 focus-visible:ring-brand"
                  aria-label={`Open notification: ${summary}`}
                >
                  <p
                    className={cn(
                      'text-base truncate',
                      group.seen ? 'text-normal' : 'text-high'
                    )}
                  >
                    <NotificationMessage
                      segments={getGroupedNotificationSegments(group)}
                      membersByUserId={membersByUserId}
                    />
                  </p>
                  <p className="text-sm text-low mt-0.5">
                    {formatRelativeTime(group.latest.created_at)}
                  </p>
                </button>
                {!group.seen && (
                  <button
                    type="button"
                    disabled={Boolean(error) || isUpdating}
                    onClick={(e) => {
                      e.stopPropagation();
                      markGroupSeen(group);
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                    className={cn(
                      'shrink-0 inline-flex min-h-11 items-center gap-half rounded-sm px-half py-half text-sm text-low transition-colors cursor-pointer sm:min-h-8',
                      'hover:bg-secondary hover:text-normal',
                      'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
                      'disabled:cursor-not-allowed disabled:opacity-50'
                    )}
                    aria-label={`Mark notification as read: ${summary}`}
                    title="Mark as read"
                  >
                    <CheckIcon size={14} weight="bold" />
                    <span className="hidden sm:inline">Mark as read</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
