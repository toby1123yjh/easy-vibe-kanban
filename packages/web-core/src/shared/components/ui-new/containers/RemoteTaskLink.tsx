import { useShape } from '@/shared/integrations/electric/hooks';
import { PROJECT_TASKS_SHAPE } from 'shared/remote-types';
import { LinkIcon } from '@phosphor-icons/react';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';

interface RemoteTaskLinkProps {
  projectId: string;
  taskId: string;
}

export function RemoteTaskLink({ projectId, taskId }: RemoteTaskLinkProps) {
  const appNavigation = useAppNavigation();

  // Subscribe to issues for this project via Electric sync
  const { data: tasks, isLoading } = useShape(PROJECT_TASKS_SHAPE, {
    project_id: projectId,
  });

  // Find the specific issue
  const task = tasks.find((i) => i.id === taskId);

  if (isLoading || !task) {
    return null;
  }

  return (
    <button
      type="button"
      className="flex items-center gap-half px-base text-sm text-low hover:text-normal hover:bg-secondary rounded-sm transition-colors"
      onClick={() => {
        appNavigation.goToProjectTask(projectId, taskId);
      }}
    >
      <LinkIcon className="size-icon-xs" weight="bold" />
      <span>{task.simple_id}</span>
    </button>
  );
}
