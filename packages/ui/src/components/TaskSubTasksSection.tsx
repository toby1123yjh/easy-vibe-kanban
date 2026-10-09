import { useTranslation } from 'react-i18next';
import { Droppable } from '@hello-pangea/dnd';
import {
  CollapsibleSectionHeader,
  type SectionAction,
} from './CollapsibleSectionHeader';
import { SubTaskRow } from './SubTaskRow';
import type { PriorityLevel } from './PriorityIcon';
import type { KanbanAssigneeUser } from './KanbanAssignee';

export interface SubTaskData {
  id: string;
  simpleId: string;
  title: string;
  priority: PriorityLevel | null;
  statusColor: string;
  assignees: KanbanAssigneeUser[];
  createdAt: string;
  parentTaskSortOrder: number | null;
}

export interface TaskSubTasksSectionProps {
  parentTaskId: string;
  subTasks: SubTaskData[];
  onSubTaskClick: (taskId: string) => void;
  onSubTaskMarkIndependent?: (subTaskId: string) => void;
  onSubTaskDelete?: (subTaskId: string) => void;
  onSubTaskPriorityClick?: (subTaskId: string) => void;
  onSubTaskAssigneeClick?: (subTaskId: string) => void;
  isLoading?: boolean;
  isReordering?: boolean;
  actions?: SectionAction[];
}

export function TaskSubTasksSection({
  parentTaskId,
  subTasks,
  onSubTaskClick,
  onSubTaskMarkIndependent,
  onSubTaskDelete,
  onSubTaskPriorityClick,
  onSubTaskAssigneeClick,
  isLoading,
  isReordering,
  actions,
}: TaskSubTasksSectionProps) {
  const { t } = useTranslation('common');

  return (
    <CollapsibleSectionHeader
      title={t('kanban.subIssues', 'Sub-issues')}
      persistKey="kanban-issue-sub-issues"
      defaultExpanded={true}
      actions={actions}
    >
      <Droppable droppableId={parentTaskId}>
        {(provided) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className="p-base flex flex-col relative border-t"
          >
            {isReordering && (
              <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10">
                <p className="text-low">{t('common.loading', 'Loading...')}</p>
              </div>
            )}
            {isLoading ? (
              <p className="text-low py-half">
                {t('common.loading', 'Loading...')}
              </p>
            ) : subTasks.length === 0 ? (
              <p className="text-low py-half">
                {t('kanban.noSubIssues', 'No sub-tasks')}
              </p>
            ) : (
              subTasks.map((subTask, index) => (
                <SubTaskRow
                  key={subTask.id}
                  id={subTask.id}
                  index={index}
                  simpleId={subTask.simpleId}
                  title={subTask.title}
                  priority={subTask.priority}
                  statusColor={subTask.statusColor}
                  assignees={subTask.assignees}
                  createdAt={subTask.createdAt}
                  onClick={() => onSubTaskClick(subTask.id)}
                  onMarkIndependentClick={
                    onSubTaskMarkIndependent
                      ? (e) => {
                          e.stopPropagation();
                          onSubTaskMarkIndependent(subTask.id);
                        }
                      : undefined
                  }
                  onDeleteClick={
                    onSubTaskDelete
                      ? (e) => {
                          e.stopPropagation();
                          onSubTaskDelete(subTask.id);
                        }
                      : undefined
                  }
                  onPriorityClick={
                    onSubTaskPriorityClick
                      ? (e) => {
                          e.stopPropagation();
                          onSubTaskPriorityClick(subTask.id);
                        }
                      : undefined
                  }
                  onAssigneeClick={
                    onSubTaskAssigneeClick
                      ? (e) => {
                          e.stopPropagation();
                          onSubTaskAssigneeClick(subTask.id);
                        }
                      : undefined
                  }
                />
              ))
            )}
            {provided.placeholder}

            {/* Loading overlay - preserves height while showing loading state */}
            {isReordering && (
              <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
                <span className="text-low text-sm">
                  {t('common.saving', 'Saving...')}
                </span>
              </div>
            )}
          </div>
        )}
      </Droppable>
    </CollapsibleSectionHeader>
  );
}
