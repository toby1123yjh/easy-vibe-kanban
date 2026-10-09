import { expect, test } from '@playwright/test';
import { decodeTaskShapeRow, taskShapeCollectionKey } from './taskShapeDecoder';
import { normalizeTaskDeeplink } from '../notifications';

test('decodes physical task columns without exposing a second public identity', () => {
  const original = {
    id: 'child',
    issue_number: 2,
    parent_issue_id: 'parent',
    parent_issue_sort_order: 1,
  };
  expect(decodeTaskShapeRow('issues', original)).toEqual({
    id: 'child',
    task_number: 2,
    parent_task_id: 'parent',
    parent_task_sort_order: 1,
  });
  expect(original.parent_issue_id).toBe('parent');
  expect(
    decodeTaskShapeRow('issue_relationships', {
      issue_id: 'one',
      related_issue_id: 'two',
    })
  ).toEqual({ task_id: 'one', related_task_id: 'two' });
});

test('keeps runtime and provider-native tasks outside the shape decoder', () => {
  const original = { issue_id: 'native', task_id: 'execution' };
  expect(decodeTaskShapeRow('agent_settings', original)).toBe(original);
  expect(taskShapeCollectionKey('issues')).toBe('tasks');
  expect(taskShapeCollectionKey('issue_comment_reactions')).toBe(
    'task_comment_reactions'
  );
  expect(taskShapeCollectionKey('pull_request_issues')).toBe(
    'pull_request_tasks'
  );
  expect(taskShapeCollectionKey('workspaces')).toBe('workspaces');
});

test('decodes notifications and their JSONB payload at the same boundary', () => {
  expect(
    decodeTaskShapeRow('notifications', {
      issue_id: 'one',
      notification_type: 'issue_comment_added',
      payload: JSON.stringify({
        issue_id: 'one',
        issue_title: 'Review the report',
        issue_simple_id: 'TASK-1',
      }),
    })
  ).toEqual({
    task_id: 'one',
    notification_type: 'task_comment_added',
    payload: {
      task_id: 'one',
      task_title: 'Review the report',
      task_simple_id: 'TASK-1',
    },
  });
});

test('preserves persisted task links without rewriting external issue links', () => {
  expect(normalizeTaskDeeplink('/projects/p/issues/i?comment=one')).toBe(
    '/projects/p/tasks/i?comment=one'
  );
  expect(normalizeTaskDeeplink('/projects/p/tasks/i')).toBe(
    '/projects/p/tasks/i'
  );
  expect(normalizeTaskDeeplink('https://github.com/org/repo/issues/1')).toBe(
    'https://github.com/org/repo/issues/1'
  );
  expect(normalizeTaskDeeplink(null)).toBeNull();
});
