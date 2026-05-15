import type { AppDestination } from '@/shared/lib/routes/appNavigation';

export interface KanbanProjectHeaderAction {
  id: 'workflows';
  label: string;
  destination: Extract<AppDestination, { kind: 'project-workflows' }>;
}

export function getKanbanProjectHeaderActions(
  _projectId: string
): KanbanProjectHeaderAction[] {
  // Project-level workflow templates stay hidden until they have a
  // task-linked entry path. Issue workflows are created from Task Attempts.
  return [];
}
