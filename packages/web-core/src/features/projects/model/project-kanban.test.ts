import { expect, test } from '@playwright/test';
import type { TaskSummary } from 'shared/types';
import type { Issue, ProjectStatus } from 'shared/remote-types';
import {
  buildKanbanColumns,
  groupTopLevelTasksByIssue,
  moveKanbanIssue,
  type KanbanColumnProjection,
} from './project-kanban';

function task(
  id: string,
  issueId: string,
  status: TaskSummary['status'],
  parentTaskId: string | null = null
): TaskSummary {
  return {
    id,
    project_id: 'project-1',
    issue_id: issueId,
    parent_task_id: parentTaskId,
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

function issue(id: string, statusId: string, sortOrder: number): Issue {
  return {
    id,
    project_id: 'project-1',
    issue_number: sortOrder,
    simple_id: `VK-${sortOrder}`,
    status_id: statusId,
    title: `Issue ${id}`,
    description: null,
    priority: null,
    start_date: null,
    target_date: null,
    completed_at: null,
    sort_order: sortOrder,
    parent_issue_id: null,
    parent_issue_sort_order: null,
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
    const grouped = groupTopLevelTasksByIssue([
      task('success', 'issue-1', 'succeeded'),
      task('failed', 'issue-1', 'failed'),
      task('child', 'issue-1', 'running', 'failed'),
      task('running', 'issue-1', 'running'),
    ]);

    expect(grouped.get('issue-1')?.map((item) => item.id)).toEqual([
      'failed',
      'running',
      'success',
    ]);
  });

  test('builds visible status-driven columns and searches issue identity', () => {
    const hidden = { ...status('hidden', 2), hidden: true };
    const columns = buildKanbanColumns({
      statuses: [status('done', 1), hidden, status('todo', 0)],
      issues: [issue('alpha', 'todo', 2), issue('beta', 'done', 1)],
      tags: [],
      issueTags: [],
      tasks: [task('task-1', 'alpha', 'running')],
      query: 'alpha',
    });

    expect(columns.map((column) => column.id)).toEqual(['todo', 'done']);
    expect(columns[0].issues.map((item) => item.id)).toEqual(['alpha']);
    expect(columns[0].issues[0].tasks).toHaveLength(1);
    expect(columns[1].issues).toEqual([]);
  });

  test('moves across columns without mutating the server projection', () => {
    const source: KanbanColumnProjection[] = [
      {
        id: 'todo',
        name: 'Todo',
        color: '0 0% 0%',
        sortOrder: 0,
        issues: [
          {
            id: 'alpha',
            simpleId: 'VK-1',
            title: 'Alpha',
            statusId: 'todo',
            priority: null,
            sortOrder: 1,
            tags: [],
            tasks: [],
          },
        ],
      },
      {
        id: 'done',
        name: 'Done',
        color: '0 0% 0%',
        sortOrder: 1,
        issues: [],
      },
    ];

    const result = moveKanbanIssue(source, {
      issueId: 'alpha',
      sourceStatusId: 'todo',
      targetStatusId: 'done',
      targetIndex: 0,
    });

    expect(result?.columns[1].issues[0]).toMatchObject({
      id: 'alpha',
      statusId: 'done',
    });
    expect(result?.updates).toEqual([
      { id: 'alpha', statusId: 'done', sortOrder: 2001 },
    ]);
    expect(source[0].issues[0]).toMatchObject({
      statusId: 'todo',
      sortOrder: 1,
    });
  });
});
