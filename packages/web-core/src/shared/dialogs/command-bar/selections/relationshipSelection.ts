import type { Task } from 'shared/remote-types';
import type { SelectionPage } from '../SelectionDialog';

export interface RelationshipSelectionResult {
  taskId: string;
}

export function buildRelationshipSelectionPages(
  tasks: Task[]
): Record<string, SelectionPage<RelationshipSelectionResult>> {
  return {
    selectRelationshipTask: {
      id: 'selectRelationshipTask',
      title: 'Select Task',
      buildGroups: () => [
        {
          label: 'Tasks',
          items: tasks.map((task) => ({ type: 'task' as const, task })),
        },
      ],
      onSelect: (item) => {
        if (item.type === 'task') {
          return {
            type: 'complete',
            data: { taskId: item.task.id },
          };
        }
        return { type: 'complete', data: undefined as never };
      },
    },
  };
}
