import { LoaderCircle, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskSummary } from 'shared/types';

export interface TaskDeletionActions {
  onDeleteTask?(task: TaskSummary): void;
  deletingSessionId?: string | null;
}

export function TaskDeleteButton({
  task,
  onDeleteTask,
  deletingSessionId,
  preview = false,
}: TaskDeletionActions & { task: TaskSummary; preview?: boolean }) {
  const { t } = useTranslation('tasks');
  if (!onDeleteTask || task.open_target.kind !== 'agent') return null;
  if (preview)
    return <span className="vk-task-delete-action" aria-hidden="true" />;
  const pending = deletingSessionId === task.open_target.session_id;
  const label = t('sessionDeletion.action', {
    name: task.title,
    defaultValue: 'Delete {{name}}',
  });
  return (
    <button
      type="button"
      className="vk-task-delete-action"
      data-no-drag
      aria-label={label}
      title={label}
      disabled={pending}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onDeleteTask(task);
      }}
    >
      {pending ? (
        <LoaderCircle
          aria-hidden="true"
          size={14}
          className="animate-spin motion-reduce:animate-none"
        />
      ) : (
        <Trash2 aria-hidden="true" size={14} />
      )}
    </button>
  );
}
