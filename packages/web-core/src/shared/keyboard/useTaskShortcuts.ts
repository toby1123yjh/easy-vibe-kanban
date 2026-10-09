import { useCallback, useRef, useEffect, useMemo } from 'react';
import { useParams } from '@tanstack/react-router';
import { useHotkeys } from 'react-hotkeys-hook';
import { useActions } from '@/shared/hooks/useActions';
import { Actions } from '@/shared/actions';
import {
  type ActionDefinition,
  ActionTargetType,
} from '@/shared/types/actions';
import { Scope } from '@/shared/keyboard/registry';
import { isProjectDestination } from '@/shared/lib/routes/appNavigation';
import { useCurrentAppDestination } from '@/shared/hooks/useCurrentAppDestination';
import { useCurrentKanbanRouteState } from '@/shared/hooks/useCurrentKanbanRouteState';
import { useTaskSelectionStore } from '@/shared/stores/useTaskSelectionStore';

const SEQUENCE_TIMEOUT_MS = 1500;

const OPTIONS = {
  scopes: [Scope.KANBAN],
  sequenceTimeout: SEQUENCE_TIMEOUT_MS,
} as const;

export function useTaskShortcuts() {
  const { executeAction } = useActions();
  const { projectId, taskId } = useParams({ strict: false });
  const destination = useCurrentAppDestination();
  const { isCreateMode: isCreatingTask } = useCurrentKanbanRouteState();

  const isKanban = isProjectDestination(destination);

  // Multi-selection support
  const multiSelectedTaskIds = useTaskSelectionStore((s) => s.selectedTaskIds);
  const selectAll = useTaskSelectionStore((s) => s.selectAll);
  const clearSelection = useTaskSelectionStore((s) => s.clearSelection);
  const toggleTask = useTaskSelectionStore((s) => s.toggleTask);
  const selectAdjacent = useTaskSelectionStore((s) => s.selectAdjacent);

  const executeActionRef = useRef(executeAction);
  const projectIdRef = useRef(projectId);
  const taskIdRef = useRef(taskId);
  const isKanbanRef = useRef(isKanban);
  const isCreatingTaskRef = useRef(isCreatingTask);
  const multiSelectedTaskIdsRef = useRef(multiSelectedTaskIds);
  const selectAllRef = useRef(selectAll);
  const clearSelectionRef = useRef(clearSelection);
  const toggleTaskRef = useRef(toggleTask);
  const selectAdjacentRef = useRef(selectAdjacent);

  useEffect(() => {
    executeActionRef.current = executeAction;
    projectIdRef.current = projectId;
    taskIdRef.current = taskId;
    isKanbanRef.current = isKanban;
    isCreatingTaskRef.current = isCreatingTask;
    multiSelectedTaskIdsRef.current = multiSelectedTaskIds;
    selectAllRef.current = selectAll;
    clearSelectionRef.current = clearSelection;
    toggleTaskRef.current = toggleTask;
    selectAdjacentRef.current = selectAdjacent;
  });

  // Clean up sequence timer on unmount
  useEffect(() => {
    return () => clearTimeout(sequenceTimerRef.current);
  }, []);

  // Use multi-selected IDs when available, otherwise fall back to single issue
  const taskIds = useMemo(() => {
    if (multiSelectedTaskIds.size > 0) {
      return [...multiSelectedTaskIds];
    }
    return taskId ? [taskId] : [];
  }, [multiSelectedTaskIds, taskId]);
  const taskIdsRef = useRef(taskIds);
  useEffect(() => {
    taskIdsRef.current = taskIds;
  });

  const executeTaskAction = useCallback(
    (action: ActionDefinition, e?: KeyboardEvent) => {
      if (!isKanbanRef.current) return;
      // react-hotkeys-hook does not call preventDefault for sequence hotkeys,
      // so we must do it manually to stop the second keystroke from being typed
      // into any focused input (e.g. the title field after i>c opens create mode).
      e?.preventDefault();

      const currentProjectId = projectIdRef.current;
      const currentTaskIds = taskIdsRef.current;

      if (action.requiresTarget === ActionTargetType.TASK) {
        if (!currentProjectId || currentTaskIds.length === 0) return;
        executeActionRef.current(
          action,
          undefined,
          currentProjectId,
          currentTaskIds
        );
      } else if (action.requiresTarget === ActionTargetType.NONE) {
        executeActionRef.current(action);
      }
    },
    []
  );

  const enabled = isKanban;

  // Track when a sequence prefix key (i) is pressed so standalone keys
  // like `x` don't fire during a sequence like `i>x`.
  const sequencePendingRef = useRef(false);
  const sequenceTimerRef = useRef<ReturnType<typeof setTimeout>>();
  useHotkeys(
    'i',
    () => {
      sequencePendingRef.current = true;
      clearTimeout(sequenceTimerRef.current);
      sequenceTimerRef.current = setTimeout(() => {
        sequencePendingRef.current = false;
      }, SEQUENCE_TIMEOUT_MS);
    },
    { scopes: [Scope.KANBAN], enabled, keydown: true, keyup: false }
  );

  useHotkeys('i>c', (e) => executeTaskAction(Actions.CreateTask, e), {
    ...OPTIONS,
    enabled,
  });
  useHotkeys(
    'i>s',
    (e) => {
      if (isCreatingTaskRef.current) {
        executeTaskAction(Actions.ChangeNewTaskStatus, e);
      } else {
        executeTaskAction(Actions.ChangeTaskStatus, e);
      }
    },
    { ...OPTIONS, enabled }
  );
  useHotkeys(
    'i>p',
    (e) => {
      if (isCreatingTaskRef.current) {
        executeTaskAction(Actions.ChangeNewTaskPriority, e);
      } else {
        executeTaskAction(Actions.ChangePriority, e);
      }
    },
    { ...OPTIONS, enabled }
  );
  useHotkeys(
    'i>a',
    (e) => {
      if (isCreatingTaskRef.current) {
        executeTaskAction(Actions.ChangeNewTaskAssignees, e);
      } else {
        executeTaskAction(Actions.ChangeAssignees, e);
      }
    },
    { ...OPTIONS, enabled }
  );
  useHotkeys('i>m', (e) => executeTaskAction(Actions.MakeSubTaskOf, e), {
    ...OPTIONS,
    enabled,
  });
  useHotkeys('i>b', (e) => executeTaskAction(Actions.AddSubTask, e), {
    ...OPTIONS,
    enabled,
  });
  useHotkeys('i>u', (e) => executeTaskAction(Actions.RemoveParentTask, e), {
    ...OPTIONS,
    enabled,
  });
  useHotkeys('i>w', (e) => executeTaskAction(Actions.LinkWorkspace, e), {
    ...OPTIONS,
    enabled,
  });
  useHotkeys('i>d', (e) => executeTaskAction(Actions.DuplicateTask, e), {
    ...OPTIONS,
    enabled,
  });
  useHotkeys('i>x', (e) => executeTaskAction(Actions.DeleteTask, e), {
    ...OPTIONS,
    enabled,
  });

  // Select all visible issues
  useHotkeys(
    'mod+a',
    (e) => {
      if (!isKanbanRef.current) return;
      e.preventDefault();
      selectAllRef.current();
    },
    { scopes: [Scope.KANBAN], enabled }
  );

  // Clear selection on Escape
  useHotkeys(
    'escape',
    (e) => {
      if (!isKanbanRef.current) return;
      if (multiSelectedTaskIdsRef.current.size > 0) {
        e.preventDefault();
        e.stopPropagation();
        clearSelectionRef.current();
      }
    },
    { scopes: [Scope.KANBAN], enabled }
  );

  // Toggle current issue selection with X
  useHotkeys(
    'x',
    (e) => {
      if (!isKanbanRef.current) return;
      // Skip if part of a sequence (e.g. i>x for delete)
      if (sequencePendingRef.current) return;
      const currentTaskId = taskIdRef.current;
      if (!currentTaskId) return;
      e.preventDefault();
      toggleTaskRef.current(currentTaskId);
    },
    { scopes: [Scope.KANBAN], enabled }
  );

  // Extend selection with Shift+J / Shift+ArrowDown (select next issue)
  useHotkeys(
    'shift+j, shift+down',
    (e) => {
      if (!isKanbanRef.current) return;
      e.preventDefault();
      selectAdjacentRef.current('down', taskIdRef.current);
    },
    { scopes: [Scope.KANBAN], enabled }
  );

  // Extend selection with Shift+K / Shift+ArrowUp (select previous issue)
  useHotkeys(
    'shift+k, shift+up',
    (e) => {
      if (!isKanbanRef.current) return;
      e.preventDefault();
      selectAdjacentRef.current('up', taskIdRef.current);
    },
    { scopes: [Scope.KANBAN], enabled }
  );
}
