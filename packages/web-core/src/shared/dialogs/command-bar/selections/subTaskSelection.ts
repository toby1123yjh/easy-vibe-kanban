import type { Task } from 'shared/remote-types';
import type { SelectionPage } from '../SelectionDialog';

export type SubTaskSelectionResult =
  | { type: 'selected'; taskId: string }
  | { type: 'createNew' };

export function buildSubTaskSelectionPages(
  tasks: Task[],
  mode: 'addChild' | 'setParent'
): Record<string, SelectionPage<SubTaskSelectionResult>> {
  const title = mode === 'setParent' ? 'Make Sub-task of' : 'Add Sub-task';
  return {
    selectSubTask: {
      id: 'selectSubTask',
      title,
      buildGroups: () => [
        {
          label: 'Tasks',
          items: [
            ...(mode === 'addChild'
              ? [{ type: 'createSubTask' as const }]
              : []),
            ...tasks.map((task) => ({ type: 'task' as const, task })),
          ],
        },
      ],
      onSelect: (item) => {
        if (item.type === 'task') {
          return {
            type: 'complete',
            data: { type: 'selected', taskId: item.task.id },
          };
        }
        if (item.type === 'createSubTask') {
          return {
            type: 'complete',
            data: { type: 'createNew' },
          };
        }
        return { type: 'complete', data: undefined as never };
      },
    },
  };
}
