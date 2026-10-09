import { useMemo } from 'react';
import {
  KANBAN_ASSIGNEE_FILTER_VALUES,
  type KanbanFilterState,
} from '@/shared/stores/useUiPreferencesStore';
import type {
  Task,
  TaskAssignee,
  TaskRelationship,
  TaskTag,
  TaskPriority,
} from 'shared/remote-types';

type UseKanbanFiltersParams = {
  tasks: Task[];
  taskAssignees: TaskAssignee[];
  taskTags: TaskTag[];
  taskRelationships: TaskRelationship[];
  tasksById: Map<string, Task>;
  doneStatusIds: Set<string>;
  filters: KanbanFilterState;
  showSubTasks: boolean;
  hideBlocked: boolean;
  currentUserId: string | null;
};

type UseKanbanFiltersResult = {
  filteredTasks: Task[];
};

export const PRIORITY_ORDER: Record<TaskPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function useKanbanFilters({
  tasks,
  taskAssignees,
  taskTags,
  taskRelationships,
  tasksById,
  doneStatusIds,
  filters,
  showSubTasks,
  hideBlocked,
  currentUserId,
}: UseKanbanFiltersParams): UseKanbanFiltersResult {
  // Create lookup maps for efficient filtering
  const assigneesByTask = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const ia of taskAssignees) {
      if (!map[ia.task_id]) {
        map[ia.task_id] = [];
      }
      map[ia.task_id].push(ia.user_id);
    }
    return map;
  }, [taskAssignees]);

  const tagsByTask = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const it of taskTags) {
      if (!map[it.task_id]) {
        map[it.task_id] = [];
      }
      map[it.task_id].push(it.tag_id);
    }
    return map;
  }, [taskTags]);

  // Filter issues
  const filteredTasks = useMemo(() => {
    let result = tasks;

    // Filter sub-issues based on per-project preference
    if (!showSubTasks) {
      result = result.filter((task) => task.parent_task_id === null);
    }

    // Text search (title + short ID)
    const query = filters.searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter((task) => {
        if (task.title.toLowerCase().includes(query)) {
          return true;
        }

        const simpleId = task.simple_id.toLowerCase();
        if (simpleId.includes(query)) {
          return true;
        }

        const taskNumber = String(task.task_number);
        return taskNumber.includes(query);
      });
    }

    // Priority filter (OR within)
    if (filters.priorities.length > 0) {
      result = result.filter(
        (task) =>
          task.priority !== null && filters.priorities.includes(task.priority)
      );
    }

    // Assignee filter (OR within)
    if (filters.assigneeIds.length > 0) {
      const includeUnassigned = filters.assigneeIds.includes(
        KANBAN_ASSIGNEE_FILTER_VALUES.UNASSIGNED
      );
      const selectedAssigneeIds = new Set(
        filters.assigneeIds.flatMap((assigneeId) => {
          if (assigneeId === KANBAN_ASSIGNEE_FILTER_VALUES.SELF) {
            return currentUserId ? [currentUserId] : [];
          }
          if (assigneeId === KANBAN_ASSIGNEE_FILTER_VALUES.UNASSIGNED) {
            return [];
          }
          return [assigneeId];
        })
      );

      result = result.filter((task) => {
        const taskAssigneeIds = assigneesByTask[task.id] ?? [];

        // Check for 'unassigned' special case
        if (includeUnassigned) {
          if (taskAssigneeIds.length === 0) return true;
        }

        // Check if any of the issue's assignees match the filter
        return taskAssigneeIds.some((assigneeId) =>
          selectedAssigneeIds.has(assigneeId)
        );
      });
    }

    // Tags filter (OR within)
    if (filters.tagIds.length > 0) {
      result = result.filter((task) => {
        const taskTagIds = tagsByTask[task.id] ?? [];
        return taskTagIds.some((tagId) => filters.tagIds.includes(tagId));
      });
    }

    // Hide blocked: filter out issues that are blocked by an unresolved issue
    if (hideBlocked) {
      result = result.filter((task) => {
        return !taskRelationships.some((r) => {
          if (r.relationship_type !== 'blocking') return false;
          if (r.related_task_id !== task.id) return false;
          const blockingIssue = tasksById.get(r.task_id);
          if (blockingIssue == null) return false;
          // Blocker is resolved if it's in a done status
          return !doneStatusIds.has(blockingIssue.status_id);
        });
      });
    }

    // Note: Sorting is handled in KanbanContainer after grouping by status
    // so that sort order is applied within each column

    return result;
  }, [
    tasks,
    filters,
    assigneesByTask,
    tagsByTask,
    showSubTasks,
    hideBlocked,
    taskRelationships,
    tasksById,
    doneStatusIds,
    currentUserId,
  ]);

  return {
    filteredTasks,
  };
}
