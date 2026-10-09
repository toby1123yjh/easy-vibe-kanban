import type { ExecutionStatus, ExecutionSummary } from 'shared/types';
import type {
  Task,
  TaskPriority,
  ProjectStatus,
  Tag,
} from 'shared/remote-types';

export const KANBAN_POINTER_ACTIVATION_DISTANCE = 8;

const EXECUTION_STATUS_ATTENTION_ORDER: Record<ExecutionStatus, number> = {
  waiting: 0,
  failed: 1,
  running: 2,
  draft: 3,
  pending: 3,
  succeeded: 4,
  cancelled: 5,
};

export interface KanbanTaskProjection {
  id: string;
  simpleId: string;
  title: string;
  statusId: string;
  priority: TaskPriority | null;
  sortOrder: number;
  tags: Tag[];
  executions: ExecutionSummary[];
}

export interface KanbanColumnProjection {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  tasks: KanbanTaskProjection[];
}

export interface KanbanMoveIntent {
  taskId: string;
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

export function sortExecutionSummaries(
  executions: ExecutionSummary[]
): ExecutionSummary[] {
  return [...executions].sort((left, right) => {
    const attention =
      EXECUTION_STATUS_ATTENTION_ORDER[left.status] -
      EXECUTION_STATUS_ATTENTION_ORDER[right.status];
    if (attention !== 0) return attention;

    const updated = right.updated_at.localeCompare(left.updated_at);
    return updated !== 0 ? updated : left.id.localeCompare(right.id);
  });
}

export function groupTopLevelExecutionsByTask(
  executions: ExecutionSummary[]
): Map<string, ExecutionSummary[]> {
  const grouped = new Map<string, ExecutionSummary[]>();
  for (const execution of executions) {
    if (execution.parent_execution_id !== null) continue;
    const taskExecutions = grouped.get(execution.task_id) ?? [];
    taskExecutions.push(execution);
    grouped.set(execution.task_id, taskExecutions);
  }
  for (const [taskId, taskExecutions] of grouped) {
    grouped.set(taskId, sortExecutionSummaries(taskExecutions));
  }
  return grouped;
}

export function buildKanbanColumns({
  statuses,
  tasks,
  tags,
  taskTags,
  executions,
  query,
}: {
  statuses: ProjectStatus[];
  tasks: Task[];
  tags: Tag[];
  taskTags: Array<{ task_id: string; tag_id: string }>;
  executions: ExecutionSummary[];
  query: string;
}): KanbanColumnProjection[] {
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const tagIdsByTask = new Map<string, string[]>();
  for (const link of taskTags) {
    const ids = tagIdsByTask.get(link.task_id) ?? [];
    ids.push(link.tag_id);
    tagIdsByTask.set(link.task_id, ids);
  }
  const executionsByTask = groupTopLevelExecutionsByTask(executions);
  const normalizedQuery = query.trim().toLocaleLowerCase();

  const projectedTasks = tasks
    .filter((task) => {
      if (!normalizedQuery) return true;
      return `${task.simple_id} ${task.title}`
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    })
    .map<KanbanTaskProjection>((task) => ({
      id: task.id,
      simpleId: task.simple_id,
      title: task.title,
      statusId: task.status_id,
      priority: task.priority,
      sortOrder: task.sort_order,
      tags: (tagIdsByTask.get(task.id) ?? [])
        .map((tagId) => tagsById.get(tagId))
        .filter((tag): tag is Tag => tag !== undefined)
        .slice(0, 2),
      executions: executionsByTask.get(task.id) ?? [],
    }));

  const tasksByStatus = new Map<string, KanbanTaskProjection[]>();
  for (const task of projectedTasks) {
    const statusTasks = tasksByStatus.get(task.statusId) ?? [];
    statusTasks.push(task);
    tasksByStatus.set(task.statusId, statusTasks);
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
      tasks: [...(tasksByStatus.get(status.id) ?? [])].sort(
        (left, right) =>
          left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)
      ),
    }));
}

export function findKanbanTask(
  columns: KanbanColumnProjection[],
  taskId: string
): KanbanTaskProjection | null {
  for (const column of columns) {
    const task = column.tasks.find((candidate) => candidate.id === taskId);
    if (task) return task;
  }
  return null;
}

export function moveKanbanTask(
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

  const sourceTaskIndex = columns[sourceColumnIndex].tasks.findIndex(
    (task) => task.id === intent.taskId
  );
  if (sourceTaskIndex < 0) return null;

  const nextColumns = columns.map((column) => ({
    ...column,
    tasks: column.tasks.map((task) => ({ ...task })),
  }));
  const [movedTask] = nextColumns[sourceColumnIndex].tasks.splice(
    sourceTaskIndex,
    1
  );
  movedTask.statusId = intent.targetStatusId;

  const targetTasks = nextColumns[targetColumnIndex].tasks;
  const targetIndex = Math.max(
    0,
    Math.min(intent.targetIndex, targetTasks.length)
  );
  targetTasks.splice(targetIndex, 0, movedTask);

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
    column.tasks.forEach((task, index) => {
      // Keep the established canonical ordering range for each status column.
      // Re-numbering every column from 1 would create duplicate sort values
      // across statuses and drift from existing inserts/mutations.
      task.sortOrder = 1000 * columnIndex + index + 1;
      updates.push({
        id: task.id,
        statusId: column.id,
        sortOrder: task.sortOrder,
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

export function executionStatusLabel(status: ExecutionStatus): string {
  const labels: Record<ExecutionStatus, string> = {
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

export function executionKindLabel(
  executionKind: ExecutionSummary['execution_kind']
): string {
  return executionKind === 'agent'
    ? 'Single agent'
    : executionKind === 'workflow'
      ? 'Workflow'
      : 'Arena';
}
