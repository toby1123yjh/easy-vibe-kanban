import type { AppDestination } from '@/shared/lib/routes/appNavigation';

export interface KanbanProjectHeaderAction {
  id: 'workflows';
  label: string;
  destination: Extract<AppDestination, { kind: 'project-workflows' }>;
}

export function getKanbanProjectHeaderActions(
  projectId: string
): KanbanProjectHeaderAction[] {
  return [
    {
      id: 'workflows',
      label: 'Workflows',
      destination: {
        kind: 'project-workflows',
        projectId,
      },
    },
  ];
}
