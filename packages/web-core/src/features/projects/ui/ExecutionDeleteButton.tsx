import { LoaderCircle, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ExecutionSummary } from 'shared/types';

export interface ExecutionDeletionActions {
  onDeleteExecution?(execution: ExecutionSummary): void;
  deletingSessionId?: string | null;
}

export function ExecutionDeleteButton({
  execution,
  onDeleteExecution,
  deletingSessionId,
  preview = false,
}: ExecutionDeletionActions & {
  execution: ExecutionSummary;
  preview?: boolean;
}) {
  const { t } = useTranslation('tasks');
  if (!onDeleteExecution || execution.open_target.kind !== 'agent') return null;
  if (preview)
    return <span className="vk-task-delete-action" aria-hidden="true" />;
  const pending = deletingSessionId === execution.open_target.session_id;
  const label = t('sessionDeletion.action', {
    name: execution.title,
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
        onDeleteExecution(execution);
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
