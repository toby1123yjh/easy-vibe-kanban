'use client';

import type { MouseEvent } from 'react';
import { cn } from '../lib/cn';
import type { KanbanAssigneeUser } from './KanbanAssignee';
import {
  TaskListSection,
  type TaskListSectionStatus,
} from './TaskListSection';
import type {
  TaskListRowTask,
  TaskListRowRelationship,
  TaskListRowTag,
} from './TaskListRow';

export interface TaskListViewProps {
  statuses: TaskListSectionStatus[];
  items: Record<string, string[]>;
  taskMap: Record<string, TaskListRowTask>;
  taskAssigneesMap: Record<string, KanbanAssigneeUser[]>;
  getTagObjectsForTask: (taskId: string) => TaskListRowTag[];
  getResolvedRelationshipsForTask?: (
    taskId: string
  ) => TaskListRowRelationship[];
  onTaskClick: (taskId: string, e: MouseEvent) => void;
  selectedTaskId: string | null;
  selectedTaskIds?: Set<string>;
  isMultiSelectActive?: boolean;
  onTaskCheckboxChange?: (taskId: string, checked: boolean) => void;
  className?: string;
}

export function TaskListView({
  statuses,
  items,
  taskMap,
  taskAssigneesMap,
  getTagObjectsForTask,
  getResolvedRelationshipsForTask,
  onTaskClick,
  selectedTaskId,
  selectedTaskIds,
  isMultiSelectActive,
  onTaskCheckboxChange,
  className,
}: TaskListViewProps) {
  return (
    <div className={cn('flex flex-col h-full overflow-y-auto', className)}>
      {statuses.map((status) => (
        <TaskListSection
          key={status.id}
          status={status}
          taskIds={items[status.id] ?? []}
          taskMap={taskMap}
          taskAssigneesMap={taskAssigneesMap}
          getTagObjectsForTask={getTagObjectsForTask}
          getResolvedRelationshipsForTask={getResolvedRelationshipsForTask}
          onTaskClick={onTaskClick}
          selectedTaskId={selectedTaskId}
          selectedTaskIds={selectedTaskIds}
          isMultiSelectActive={isMultiSelectActive}
          onTaskCheckboxChange={onTaskCheckboxChange}
        />
      ))}
    </div>
  );
}
