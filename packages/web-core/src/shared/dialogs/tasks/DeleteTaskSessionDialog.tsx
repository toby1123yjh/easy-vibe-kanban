import { useEffect, useRef, useState } from 'react';
import { create, useModal } from '@ebay/nice-modal-react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle } from 'lucide-react';
import type { TaskSummary } from 'shared/types';
import { ConfirmDialogView } from '@vibe/ui/components/ConfirmDialog';
import { defineModal, type DeleteResult } from '@/shared/lib/modals';
import { ApiError } from '@/shared/lib/api';

export interface ResolvedTaskSessionDeleteTarget {
  title: string;
  task: TaskSummary | null;
}

interface DeleteTaskSessionDialogProps {
  resolveTarget(): Promise<ResolvedTaskSessionDeleteTarget>;
  onDelete(
    target: ResolvedTaskSessionDeleteTarget,
    stopRunning: boolean
  ): Promise<void>;
}

const DeleteTaskSessionDialogImpl = create<DeleteTaskSessionDialogProps>(
  ({ resolveTarget, onDelete }) => {
    const modal = useModal();
    const { t } = useTranslation(['tasks', 'common']);
    const pendingRef = useRef(false);
    const [target, setTarget] =
      useState<ResolvedTaskSessionDeleteTarget | null>(null);
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [retry, setRetry] = useState(0);
    const [requiresStop, setRequiresStop] = useState(false);

    useEffect(() => {
      let active = true;
      setTarget(null);
      setLoading(true);
      setError(null);
      void resolveTarget().then(
        (resolved) => {
          if (active) {
            setTarget(resolved);
            setLoading(false);
          }
        },
        (cause: unknown) => {
          if (active) {
            setError(
              cause instanceof Error
                ? cause.message
                : t('sessionDeletion.failed')
            );
            setLoading(false);
          }
        }
      );
      return () => {
        active = false;
      };
    }, [resolveTarget, retry, t]);

    const close = (result: DeleteResult) => {
      modal.resolve(result);
      void modal.hide();
      modal.remove();
    };
    const cancel = () => {
      if (!pendingRef.current) close('canceled');
    };
    const confirm = async () => {
      if (!target || loading || pendingRef.current) return;
      pendingRef.current = true;
      setDeleting(true);
      setError(null);
      try {
        await onDelete(target, requiresStop);
        close('deleted');
      } catch (cause) {
        if (
          cause instanceof ApiError &&
          cause.status === 409 &&
          typeof cause.error_data === 'object' &&
          cause.error_data !== null &&
          'code' in cause.error_data &&
          cause.error_data.code === 'session_requires_stop'
        ) {
          setRequiresStop(true);
          setError(
            requiresStop
              ? t('sessionDeletion.stopFailed', {
                  defaultValue:
                    'The agent has not stopped yet. Your task and session were kept; retry when ready.',
                })
              : null
          );
          return;
        }
        setError(
          cause instanceof Error ? cause.message : t('sessionDeletion.failed')
        );
      } finally {
        pendingRef.current = false;
        setDeleting(false);
      }
    };

    const retryLookup = !target && !!error;
    return (
      <ConfirmDialogView
        open={modal.visible}
        variant="destructive"
        icon={false}
        restoreFocus={false}
        title={t(
          target?.task
            ? 'sessionDeletion.taskTitle'
            : 'sessionDeletion.sessionTitle'
        )}
        message={
          requiresStop
            ? t('sessionDeletion.stopDescription', {
                name: target?.title,
                defaultValue:
                  'The agent for “{{name}}” is still running or its exit cannot be confirmed. Stop it safely, then delete? If stopping fails, the task and session will be kept.',
              })
            : target
              ? t(
                  target.task
                    ? 'sessionDeletion.taskDescription'
                    : 'sessionDeletion.sessionDescription',
                  { name: target.title }
                )
              : t('sessionDeletion.resolving')
        }
        cancelText={t('common:buttons.cancel', 'Cancel')}
        confirmText={
          requiresStop
            ? t(
                deleting
                  ? 'sessionDeletion.stopping'
                  : 'sessionDeletion.stopAndDelete',
                {
                  defaultValue: deleting
                    ? 'Stopping and deleting…'
                    : 'Stop and delete',
                }
              )
            : retryLookup
              ? t('common:buttons.retry', 'Retry')
              : t(
                  deleting
                    ? 'sessionDeletion.deleting'
                    : target?.task
                      ? 'sessionDeletion.deleteTask'
                      : 'sessionDeletion.deleteSession'
                )
        }
        confirmVariant={retryLookup ? 'default' : 'destructive'}
        confirmDisabled={loading || (!target && !retryLookup)}
        confirmPending={deleting}
        cancelDisabled={deleting}
        onCancel={cancel}
        onConfirm={() => {
          if (retryLookup) setRetry((value) => value + 1);
          else void confirm();
        }}
      >
        {loading && (
          <LoaderCircle
            aria-hidden="true"
            className="size-4 animate-spin motion-reduce:animate-none"
          />
        )}
        {error && (
          <p role="alert" className="text-sm text-[var(--vk-status-error)]">
            {error}
          </p>
        )}
      </ConfirmDialogView>
    );
  }
);

export const DeleteTaskSessionDialog = defineModal<
  DeleteTaskSessionDialogProps,
  DeleteResult
>(DeleteTaskSessionDialogImpl);
