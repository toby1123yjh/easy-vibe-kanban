import { useCallback, useMemo } from 'react';
import { useActions } from '@/shared/hooks/useActions';
import { Actions } from '@/shared/actions';
import { BulkActionBar } from '@vibe/ui/components/BulkActionBar';
import { useTaskSelectionStore } from '@/shared/stores/useTaskSelectionStore';

interface BulkActionBarContainerProps {
  projectId: string;
}

export function BulkActionBarContainer({
  projectId,
}: BulkActionBarContainerProps) {
  const selectedTaskIds = useTaskSelectionStore((s) => s.selectedTaskIds);
  const clearSelection = useTaskSelectionStore((s) => s.clearSelection);
  const {
    executeAction,
    openStatusSelection,
    openPrioritySelection,
    openAssigneeSelection,
  } = useActions();

  const taskIds = useMemo(() => [...selectedTaskIds], [selectedTaskIds]);

  const handleChangeStatus = useCallback(async () => {
    await openStatusSelection(projectId, taskIds);
  }, [projectId, taskIds, openStatusSelection]);

  const handleChangePriority = useCallback(async () => {
    await openPrioritySelection(projectId, taskIds);
  }, [projectId, taskIds, openPrioritySelection]);

  const handleChangeAssignees = useCallback(async () => {
    await openAssigneeSelection(projectId, taskIds);
  }, [projectId, taskIds, openAssigneeSelection]);

  const handleDelete = useCallback(async () => {
    await executeAction(Actions.DeleteTask, undefined, projectId, taskIds);
    clearSelection();
  }, [executeAction, projectId, taskIds, clearSelection]);

  return (
    <BulkActionBar
      selectedCount={selectedTaskIds.size}
      onChangeStatus={handleChangeStatus}
      onChangePriority={handleChangePriority}
      onChangeAssignees={handleChangeAssignees}
      onDelete={handleDelete}
      onClearSelection={clearSelection}
    />
  );
}
