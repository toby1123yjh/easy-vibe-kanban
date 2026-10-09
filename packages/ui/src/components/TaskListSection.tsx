'use client';

import { useCallback, useState, type MouseEvent } from 'react';
import { cn } from '../lib/cn';
import { Droppable } from '@hello-pangea/dnd';
import { CaretDownIcon } from '@phosphor-icons/react';
import { StatusDot } from './StatusDot';
import { KanbanBadge } from './KanbanBadge';
import {
  TaskListRow,
  type TaskListRowTask,
  type TaskListRowTag,
  type TaskListRowRelationship,
} from './TaskListRow';
import type { KanbanAssigneeUser } from './KanbanAssignee';

export interface TaskListSectionStatus {
  id: string;
  name: string;
  color: string;
}

export interface TaskListSectionProps {
  status: TaskListSectionStatus;
  taskIds: string[];
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

export function TaskListSection({
  status,
  taskIds,
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
}: TaskListSectionProps) {
  const storageKey = `ui.issue-list-section.${status.id}`;
  const [isExpanded, setExpanded] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem(storageKey);
    return stored == null ? true : stored === 'true';
  });
  const handleToggleExpanded = useCallback(() => {
    setExpanded((prevExpanded) => {
      const nextExpanded = !prevExpanded;
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, String(nextExpanded));
      }
      return nextExpanded;
    });
  }, [storageKey]);

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Section Header */}
      <button
        type="button"
        onClick={handleToggleExpanded}
        className={cn(
          'flex items-center justify-between',
          'h-8 px-double py-base',
          'bg-panel border-y border-border',
          'cursor-pointer transition-colors',
          'hover:bg-secondary'
        )}
      >
        <div className="flex items-center gap-base">
          <CaretDownIcon
            className={cn(
              'size-icon-xs text-low transition-transform',
              !isExpanded && '-rotate-90'
            )}
            weight="bold"
          />
          <StatusDot color={status.color} />
          <span className="text-base font-medium text-high">{status.name}</span>
        </div>
        <KanbanBadge name={String(taskIds.length)} />
      </button>

      {/* Section Content - Droppable area */}
      <Droppable droppableId={status.id}>
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="flex flex-col min-h-8"
          >
            {isExpanded &&
              taskIds.map((taskId, index) => {
                const task = taskMap[taskId];
                if (!task) return null;

                return (
                  <TaskListRow
                    key={task.id}
                    task={task}
                    index={index}
                    statusColor={status.color}
                    tags={getTagObjectsForTask(task.id)}
                    relationships={getResolvedRelationshipsForTask?.(task.id)}
                    assignees={taskAssigneesMap[task.id] ?? []}
                    onClick={(e) => onTaskClick(task.id, e)}
                    isSelected={selectedTaskId === task.id}
                    isMultiSelectActive={isMultiSelectActive}
                    isChecked={selectedTaskIds?.has(task.id)}
                    onCheckboxChange={(checked) =>
                      onTaskCheckboxChange?.(task.id, checked)
                    }
                  />
                );
              })}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    </div>
  );
}
