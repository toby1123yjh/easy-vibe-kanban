import type { TaskRelationship, Task } from 'shared/remote-types';

export type RelationshipDisplayType =
  | 'blocks'
  | 'blocked_by'
  | 'related'
  | 'duplicate_of'
  | 'duplicated_by';

export interface ResolvedRelationship {
  relationshipId: string;
  displayType: RelationshipDisplayType;
  relatedTaskId: string;
  relatedTaskDisplayId: string;
}

export function resolveRelationshipsForTask(
  taskId: string,
  relationships: TaskRelationship[],
  tasksById: Map<string, Task>
): ResolvedRelationship[] {
  return relationships
    .map((r) => {
      const isSource = r.task_id === taskId;
      const otherTaskId = isSource ? r.related_task_id : r.task_id;
      const otherTask = tasksById.get(otherTaskId);
      if (!otherTask) return null;

      let displayType: RelationshipDisplayType;
      if (r.relationship_type === 'blocking') {
        displayType = isSource ? 'blocks' : 'blocked_by';
      } else if (r.relationship_type === 'related') {
        displayType = 'related';
      } else {
        displayType = isSource ? 'duplicate_of' : 'duplicated_by';
      }

      return {
        relationshipId: r.id,
        displayType,
        relatedTaskId: otherTaskId,
        relatedTaskDisplayId: otherTask.simple_id,
      };
    })
    .filter((r): r is ResolvedRelationship => r !== null);
}

export function getRelationshipLabel(
  displayType: RelationshipDisplayType
): string {
  switch (displayType) {
    case 'blocks':
      return 'blocks';
    case 'blocked_by':
      return 'blocked by';
    case 'related':
      return 'related';
    case 'duplicate_of':
      return 'dup of';
    case 'duplicated_by':
      return 'dup';
  }
}
