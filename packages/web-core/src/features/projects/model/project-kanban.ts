import type { TaskStatus, TaskSummary } from 'shared/types';
import type {
  Issue,
  IssuePriority,
  ProjectStatus,
  Tag,
} from 'shared/remote-types';

export const KANBAN_POINTER_ACTIVATION_DISTANCE = 8;

const TASK_STATUS_ATTENTION_ORDER: Record<TaskStatus, number> = {
  waiting: 0,
  failed: 1,
  running: 2,
  draft: 3,
  pending: 3,
  succeeded: 4,
  cancelled: 5,
};

export interface KanbanIssueProjection {
  id: string;
  simpleId: string;
  title: string;
  statusId: string;
  priority: IssuePriority | null;
  sortOrder: number;
  tags: Tag[];
  tasks: TaskSummary[];
}

export interface KanbanColumnProjection {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  issues: KanbanIssueProjection[];
}

export interface KanbanMoveIntent {
  issueId: string;
  sourceStatusId: string;
  targetStatusId: string;
  targetIndex: number;
}

export interface KanbanMoveUpdate {
  id: string;
  statusId: string;
  sortOrder: number;
}

export interface KanbanMoveResult {
  columns: KanbanColumnProjection[];
  updates: KanbanMoveUpdate[];
}

export function sortTaskSummaries(tasks: TaskSummary[]): TaskSummary[] {
  return [...tasks].sort((left, right) => {
    const attention =
      TASK_STATUS_ATTENTION_ORDER[left.status] -
      TASK_STATUS_ATTENTION_ORDER[right.status];
    if (attention !== 0) return attention;

    const updated = right.updated_at.localeCompare(left.updated_at);
    return updated !== 0 ? updated : left.id.localeCompare(right.id);
  });
}

export function groupTopLevelTasksByIssue(
  tasks: TaskSummary[]
): Map<string, TaskSummary[]> {
  const grouped = new Map<string, TaskSummary[]>();
  for (const task of tasks) {
    if (task.parent_task_id !== null) continue;
    const issueTasks = grouped.get(task.issue_id) ?? [];
    issueTasks.push(task);
    grouped.set(task.issue_id, issueTasks);
  }
  for (const [issueId, issueTasks] of grouped) {
    grouped.set(issueId, sortTaskSummaries(issueTasks));
  }
  return grouped;
}

export function buildKanbanColumns({
  statuses,
  issues,
  tags,
  issueTags,
  tasks,
  query,
}: {
  statuses: ProjectStatus[];
  issues: Issue[];
  tags: Tag[];
  issueTags: Array<{ issue_id: string; tag_id: string }>;
  tasks: TaskSummary[];
  query: string;
}): KanbanColumnProjection[] {
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const tagIdsByIssue = new Map<string, string[]>();
  for (const link of issueTags) {
    const ids = tagIdsByIssue.get(link.issue_id) ?? [];
    ids.push(link.tag_id);
    tagIdsByIssue.set(link.issue_id, ids);
  }
  const tasksByIssue = groupTopLevelTasksByIssue(tasks);
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const projectedIssues = issues
    .filter((issue) => {
      if (!normalizedQuery) return true;
      return `${issue.simple_id} ${issue.title}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    })
    .map<KanbanIssueProjection>((issue) => ({
      id: issue.id,
      simpleId: issue.simple_id,
      title: issue.title,
      statusId: issue.status_id,
      priority: issue.priority,
      sortOrder: issue.sort_order,
      tags: (tagIdsByIssue.get(issue.id) ?? [])
        .map((tagId) => tagsById.get(tagId))
        .filter((tag): tag is Tag => tag !== undefined)
        .slice(0, 2),
      tasks: tasksByIssue.get(issue.id) ?? [],
    }));

  const issuesByStatus = new Map<string, KanbanIssueProjection[]>();
  for (const issue of projectedIssues) {
    const statusIssues = issuesByStatus.get(issue.statusId) ?? [];
    statusIssues.push(issue);
    issuesByStatus.set(issue.statusId, statusIssues);
  }

  return statuses
    .filter((status) => !status.hidden)
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order || left.id.localeCompare(right.id)
    )
    .map((status) => ({
      id: status.id,
      name: status.name,
      color: status.color,
      sortOrder: status.sort_order,
      issues: [...(issuesByStatus.get(status.id) ?? [])].sort(
        (left, right) =>
          left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
      ),
    }));
}

export function findKanbanIssue(
  columns: KanbanColumnProjection[],
  issueId: string
): KanbanIssueProjection | null {
  for (const column of columns) {
    const issue = column.issues.find((candidate) => candidate.id === issueId);
    if (issue) return issue;
  }
  return null;
}

export function moveKanbanIssue(
  columns: KanbanColumnProjection[],
  intent: KanbanMoveIntent
): KanbanMoveResult | null {
  const sourceColumnIndex = columns.findIndex(
    (column) => column.id === intent.sourceStatusId
  );
  const targetColumnIndex = columns.findIndex(
    (column) => column.id === intent.targetStatusId
  );
  if (sourceColumnIndex < 0 || targetColumnIndex < 0) return null;

  const sourceIssueIndex = columns[sourceColumnIndex].issues.findIndex(
    (issue) => issue.id === intent.issueId
  );
  if (sourceIssueIndex < 0) return null;

  const nextColumns = columns.map((column) => ({
    ...column,
    issues: column.issues.map((issue) => ({ ...issue })),
  }));
  const [movedIssue] = nextColumns[sourceColumnIndex].issues.splice(
    sourceIssueIndex,
    1
  );
  movedIssue.statusId = intent.targetStatusId;

  const targetIssues = nextColumns[targetColumnIndex].issues;
  const targetIndex = Math.max(
    0,
    Math.min(intent.targetIndex, targetIssues.length)
  );
  targetIssues.splice(targetIndex, 0, movedIssue);

  const affectedStatusIds = new Set([
    intent.sourceStatusId,
    intent.targetStatusId,
  ]);
  const statusColumnIndex = new Map(
    nextColumns.map((column, index) => [column.id, index + 1])
  );
  const updates: KanbanMoveUpdate[] = [];
  for (const column of nextColumns) {
    if (!affectedStatusIds.has(column.id)) continue;
    const columnIndex = statusColumnIndex.get(column.id) ?? 1;
    column.issues.forEach((issue, index) => {
      // Keep the established canonical ordering range for each status column.
      // Re-numbering every column from 1 would create duplicate sort values
      // across statuses and drift from existing inserts/mutations.
      issue.sortOrder = 1000 * columnIndex + index + 1;
      updates.push({
        id: issue.id,
        statusId: column.id,
        sortOrder: issue.sortOrder,
      });
    });
  }

  return { columns: nextColumns, updates };
}

export function isInteractiveDragTarget(
  target: EventTarget | null,
  draggableRoot?: Element
): boolean {
  if (!(target instanceof Element)) return false;
  const interactive = target.closest(
    'button, a, input, textarea, select, option, [role="button"], [data-no-drag]'
  );
  return interactive !== null && interactive !== draggableRoot;
}

export function taskStatusLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    draft: 'Draft',
    pending: 'Pending',
    running: 'Running',
    waiting: 'Waiting',
    succeeded: 'Succeeded',
    failed: 'Failed',
    cancelled: 'Cancelled',
  };
  return labels[status];
}

export function taskExecutionLabel(
  executionKind: TaskSummary['execution_kind']
): string {
  return executionKind === 'agent'
    ? 'Single agent'
    : executionKind === 'workflow'
      ? 'Workflow'
      : 'Arena';
}
