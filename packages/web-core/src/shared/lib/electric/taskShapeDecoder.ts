/** Physical Electric columns are decoded once into the public Task contract. */
type Row = Record<string, unknown>;

const TASK_FIELD_MAP: Readonly<Record<string, string>> = {
  issue_id: 'task_id',
  issue_number: 'task_number',
  parent_issue_id: 'parent_task_id',
  parent_issue_sort_order: 'parent_task_sort_order',
  related_issue_id: 'related_task_id',
};

const TASK_TABLES = new Set([
  'issues',
  'issue_assignees',
  'issue_followers',
  'issue_tags',
  'issue_relationships',
  'issue_comments',
  'issue_comment_reactions',
  'pull_request_issues',
  'pull_requests',
  'workspaces',
  'attachments',
  'notifications',
]);

function renameFields(row: Row, names: Readonly<Record<string, string>>): Row {
  const result: Row = {};
  for (const [key, value] of Object.entries(row)) {
    result[names[key] ?? key] = value;
  }
  return result;
}

/** HTTP fallback rows already use public keys; only their envelope needs this. */
export function taskShapeCollectionKey(table: string): string {
  return TASK_TABLES.has(table)
    ? table.replace('issues', 'tasks').replace('issue_', 'task_')
    : table;
}

export function decodeTaskShapeRow(table: string, row: Row): Row {
  if (!TASK_TABLES.has(table)) return row;
  const result = renameFields(row, TASK_FIELD_MAP);
  if (table !== 'notifications') return result;

  if (typeof result.notification_type === 'string') {
    result.notification_type = result.notification_type.replace(
      /^issue_/,
      'task_'
    );
  }
  // Electric JSONB can be an object or text, depending on its parser settings.
  if (typeof result.payload === 'string') {
    result.payload = JSON.parse(result.payload) as unknown;
  }
  if (
    result.payload &&
    typeof result.payload === 'object' &&
    !Array.isArray(result.payload)
  ) {
    result.payload = renameFields(result.payload as Row, {
      issue_id: 'task_id',
      issue_title: 'task_title',
      issue_simple_id: 'task_simple_id',
    });
  }
  return result;
}
