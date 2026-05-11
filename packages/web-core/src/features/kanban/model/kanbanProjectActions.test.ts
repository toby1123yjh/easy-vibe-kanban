import { describe, expect, it } from 'vitest';
import { getKanbanProjectHeaderActions } from './kanbanProjectActions';

describe('kanban project header actions', () => {
  it('exposes workflow navigation from the project header', () => {
    expect(getKanbanProjectHeaderActions('project-1')).toContainEqual({
      id: 'workflows',
      label: 'Workflows',
      destination: {
        kind: 'project-workflows',
        projectId: 'project-1',
      },
    });
  });
});
