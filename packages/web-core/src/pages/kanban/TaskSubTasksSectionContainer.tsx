import { useMemo, useCallback, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { PlusIcon, LinkIcon } from '@phosphor-icons/react';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useOrgContext } from '@/shared/hooks/useOrgContext';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useActions } from '@/shared/hooks/useActions';
import { Actions } from '@/shared/actions';
import { bulkUpdateTasks } from '@/shared/lib/remoteApi';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import {
  TaskSubTasksSection,
  type SubTaskData,
} from '@vibe/ui/components/TaskSubTasksSection';
import type { SectionAction } from '@vibe/ui/components/CollapsibleSectionHeader';

interface TaskSubTasksSectionContainerProps {
  taskId: string;
}

/**
 * Container component for the sub-issues section.
 * Fetches sub-issues from ProjectContext and transforms them for display.
 * Supports drag-and-drop reordering of sub-issues.
 */
export function TaskSubTasksSectionContainer({
  taskId,
}: TaskSubTasksSectionContainerProps) {
  const { projectId } = useParams({ strict: false });
  const appNavigation = useAppNavigation();
  const {
    executeAction,
    openSubTaskSelection,
    openPrioritySelection,
    openAssigneeSelection,
  } = useActions();

  const {
    tasks,
    statuses,
    updateTask,
    removeTask,
    getAssigneesForTask,
    isLoading: projectLoading,
  } = useProjectContext();

  const { membersWithProfilesById, isLoading: orgLoading } = useOrgContext();

  // Create lookup maps for efficient access
  const statusesById = useMemo(() => {
    return new Map(statuses.map((s) => [s.id, s]));
  }, [statuses]);

  // Filter, sort, and transform sub-issues
  const subTasks: SubTaskData[] = useMemo(() => {
    return tasks
      .filter((task) => task.parent_task_id === taskId)
      .sort((a, b) => {
        // Sort by parent_issue_sort_order (nulls last), then by created_at
        const aOrder = a.parent_task_sort_order;
        const bOrder = b.parent_task_sort_order;
        if (aOrder === null && bOrder === null) {
          return (
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        }
        if (aOrder === null) return 1;
        if (bOrder === null) return -1;
        return aOrder - bOrder;
      })
      .map((task) => {
        const status = statusesById.get(task.status_id);
        const assigneeRecords = getAssigneesForTask(task.id);
        const assignees = assigneeRecords
          .map((a) => membersWithProfilesById.get(a.user_id))
          .filter((u): u is NonNullable<typeof u> => u !== undefined);

        return {
          id: task.id,
          simpleId: task.simple_id,
          title: task.title,
          priority: task.priority,
          statusColor: status?.color ?? '#888888',
          assignees,
          createdAt: task.created_at,
          parentTaskSortOrder: task.parent_task_sort_order ?? null,
        };
      });
  }, [
    tasks,
    taskId,
    statusesById,
    membersWithProfilesById,
    getAssigneesForTask,
  ]);

  // Handle clicking on a sub-issue to navigate to it
  const handleSubTaskClick = useCallback(
    (subTaskId: string) => {
      if (!projectId) {
        return;
      }

      appNavigation.goToProjectTask(projectId, subTaskId);
    },
    [projectId, appNavigation]
  );

  // Track reordering state for loading overlay
  const [isReordering, setIsReordering] = useState(false);

  // Handle drag and drop reordering
  const handleDragEnd = useCallback(
    (result: DropResult) => {
      if (!result.destination) return;
      if (result.source.index === result.destination.index) return;

      // Reorder locally
      const reordered = [...subTasks];
      const [moved] = reordered.splice(result.source.index, 1);
      reordered.splice(result.destination.index, 0, moved);

      // Build updates: all items get sequential integers 0, 1, 2, ...
      const updates = reordered.map((item, index) => ({
        id: item.id,
        changes: { parent_task_sort_order: index },
      }));

      // Show loading overlay while saving
      setIsReordering(true);
      bulkUpdateTasks(updates)
        .catch((err) => {
          console.error('Failed to update sort order:', err);
        })
        .finally(() => {
          // Small delay before hiding loader to prevent flicker
          setTimeout(() => setIsReordering(false), 500);
        });
    },
    [subTasks]
  );

  const isLoading = projectLoading || orgLoading;

  // Handle clicking '+' to create new sub-issue immediately
  const handleCreateNewSubTask = useCallback(() => {
    if (projectId) {
      void executeAction(Actions.CreateSubTask, undefined, projectId, [taskId]);
    }
  }, [executeAction, projectId, taskId]);

  // Handle clicking link icon to select an existing issue as sub-issue
  const handleLinkSubTask = useCallback(() => {
    if (projectId) {
      openSubTaskSelection(projectId, taskId);
    }
  }, [projectId, taskId, openSubTaskSelection]);

  // Inline editing callbacks for sub-issue rows
  const handleSubTaskPriorityClick = useCallback(
    (subTaskId: string) => {
      if (projectId) {
        openPrioritySelection(projectId, [subTaskId]);
      }
    },
    [projectId, openPrioritySelection]
  );

  const handleSubTaskAssigneeClick = useCallback(
    (subTaskId: string) => {
      if (projectId) {
        openAssigneeSelection(projectId, [subTaskId]);
      }
    },
    [projectId, openAssigneeSelection]
  );

  const handleSubTaskMarkIndependent = useCallback(
    (subTaskId: string) => {
      updateTask(subTaskId, {
        parent_task_id: null,
        parent_task_sort_order: null,
      });
    },
    [updateTask]
  );

  const handleSubTaskDelete = useCallback(
    async (subTaskId: string) => {
      const subTask = tasks.find((task) => task.id === subTaskId);
      const result = await ConfirmDialog.show({
        title: 'Delete Sub-task',
        message: subTask
          ? `Are you sure you want to delete "${subTask.title}"? This action cannot be undone.`
          : 'Are you sure you want to delete this sub-task? This action cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        variant: 'destructive',
      });

      if (result === 'confirmed') {
        removeTask(subTaskId);
      }
    },
    [tasks, removeTask]
  );

  // Actions for the section header
  const actions: SectionAction[] = useMemo(
    () => [
      {
        icon: PlusIcon,
        onClick: handleCreateNewSubTask,
      },
      {
        icon: LinkIcon,
        onClick: handleLinkSubTask,
      },
    ],
    [handleCreateNewSubTask, handleLinkSubTask]
  );

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <TaskSubTasksSection
        parentTaskId={taskId}
        subTasks={subTasks}
        onSubTaskClick={handleSubTaskClick}
        onSubTaskMarkIndependent={handleSubTaskMarkIndependent}
        onSubTaskDelete={handleSubTaskDelete}
        onSubTaskPriorityClick={handleSubTaskPriorityClick}
        onSubTaskAssigneeClick={handleSubTaskAssigneeClick}
        isLoading={isLoading}
        isReordering={isReordering}
        actions={actions}
      />
    </DragDropContext>
  );
}
