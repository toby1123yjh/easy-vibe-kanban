import { useCallback, type MouseEvent } from 'react';
import { useTaskSelectionStore } from '@/shared/stores/useTaskSelectionStore';

export function useTaskMultiSelect() {
  const selectedTaskIds = useTaskSelectionStore((s) => s.selectedTaskIds);
  const toggleTask = useTaskSelectionStore((s) => s.toggleTask);
  const selectRange = useTaskSelectionStore((s) => s.selectRange);
  const clearSelection = useTaskSelectionStore((s) => s.clearSelection);
  const selectAll = useTaskSelectionStore((s) => s.selectAll);

  const isMultiSelectActive = selectedTaskIds.size > 1;

  const handleTaskClick = useCallback(
    (taskId: string, event: MouseEvent) => {
      const isMetaClick = event.metaKey || event.ctrlKey;
      const isShiftClick = event.shiftKey;

      if (isMetaClick) {
        // Cmd/Ctrl+Click: toggle this issue in multi-select
        event.preventDefault();
        toggleTask(taskId);
      } else if (isShiftClick) {
        // Shift+Click: range select from anchor to this issue
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        selectRange(taskId);
      }
    },
    [toggleTask, selectRange]
  );

  const handleCheckboxChange = useCallback(
    (taskId: string) => {
      toggleTask(taskId);
    },
    [toggleTask]
  );

  return {
    selectedTaskIds,
    isMultiSelectActive,
    handleTaskClick,
    handleCheckboxChange,
    handleSelectAll: selectAll,
    clearSelection,
  };
}
