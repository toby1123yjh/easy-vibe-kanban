import { describe, expect, it } from 'vitest';
import { getKanbanProjectHeaderActions } from './kanbanProjectActions';

describe('kanban project header actions', () => {
  it('keeps project-level workflow templates out of the issue-first header', () => {
    expect(getKanbanProjectHeaderActions('project-1')).toEqual([]);
  });
});
