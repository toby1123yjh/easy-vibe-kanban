import { expect, test } from '@playwright/test';
import type { ExecutionSummary } from 'shared/types';
import type { Task, ProjectStatus } from 'shared/remote-types';
import {
  buildKanbanColumns,
  groupTopLevelExecutionsByTask,
  moveKanbanTask,
  type KanbanColumnProjection,
} from './project-kanban';

function execution(
  id: string,
  taskId: string,
  status: ExecutionSummary['status'],
  parentExecutionId: string | null = null
): ExecutionSummary {
  return {
    id,
    project_id: 'project-1',
    task_id: taskId,
    parent_execution_id: parentExecutionId,
    title: `Task ${id}`,
    execution_kind: 'agent',
    status,
    open_target: {
      kind: 'agent',
      session_id: `session-${id}`,
      workspace_id: `workspace-${id}`,
    },
    created_at: '2026-08-29T10:00:00Z',
    updated_at: `2026-08-29T10:00:0${id.length}Z`,
  };
}

function task(id: string, statusId: string, sortOrder: number): Task {
  return {
    id,
    project_id: 'project-1',
    task_number: sortOrder,
    simple_id: `VK-${sortOrder}`,
    status_id: statusId,
    title: `Issue ${id}`,
    description: null,
    priority: null,
    start_date: null,
    target_date: null,
    completed_at: null,
    sort_order: sortOrder,
    parent_task_id: null,
    parent_task_sort_order: null,
    extension_metadata: null,
    creator_user_id: null,
    created_at: '2026-08-29T10:00:00Z',
    updated_at: '2026-08-29T10:00:00Z',
  };
}

function status(id: string, sortOrder: number): ProjectStatus {
  return {
    id,
    project_id: 'project-1',
    name: id,
    color: '25 82% 54%',
    sort_order: sortOrder,
    hidden: false,
    created_at: '2026-08-29T10:00:00Z',
  };
}

test.describe('project Kanban projection', () => {
  test('groups only top-level canonical tasks and prioritizes attention states', () => {
    const grouped = groupTopLevelExecutionsByTask([
      execution('success', 'issue-1', 'succeeded'),
      execution('failed', 'issue-1', 'failed'),
      execution('child', 'issue-1', 'running', 'failed'),
      execution('running', 'issue-1', 'running'),
    ]);

    expect(grouped.get('issue-1')?.map((item) => item.id)).toEqual([
      'failed',
      'running',
      'success',
    ]);
  });

  test('builds visible status-driven columns and searches task identity', () => {
    const hidden = { ...status('hidden', 2), hidden: true };
    const columns = buildKanbanColumns({
      statuses: [status('done', 1), hidden, status('todo', 0)],
      tasks: [task('alpha', 'todo', 2), task('beta', 'done', 1)],
      tags: [],
      taskTags: [],
      executions: [execution('task-1', 'alpha', 'running')],
      query: 'alpha',
    });

    expect(columns.map((column) => column.id)).toEqual(['todo', 'done']);
    expect(columns[0].tasks.map((item) => item.id)).toEqual(['alpha']);
    expect(columns[0].tasks[0].executions).toHaveLength(1);
    expect(columns[1].tasks).toEqual([]);
  });

  test('moves across columns without mutating the server projection', () => {
    const source: KanbanColumnProjection[] = [
      {
        id: 'todo',
        name: 'Todo',
        color: '0 0% 0%',
        sortOrder: 0,
        tasks: [
          {
            id: 'alpha',
            simpleId: 'VK-1',
            title: 'Alpha',
            statusId: 'todo',
            priority: null,
            sortOrder: 1,
            tags: [],
            executions: [],
          },
        ],
      },
      {
        id: 'done',
        name: 'Done',
        color: '0 0% 0%',
        sortOrder: 1,
        tasks: [],
      },
    ];

    const result = moveKanbanTask(source, {
      taskId: 'alpha',
      sourceStatusId: 'todo',
      targetStatusId: 'done',
      targetIndex: 0,
    });

    expect(result?.columns[1].tasks[0]).toMatchObject({
      id: 'alpha',
      statusId: 'done',
    });
    expect(result?.updates).toEqual([
      { id: 'alpha', statusId: 'done', sortOrder: 2001 },
    ]);
    expect(source[0].tasks[0]).toMatchObject({
      statusId: 'todo',
      sortOrder: 1,
    });
  });
});
