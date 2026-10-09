import { createFileRoute, useParams } from '@tanstack/react-router';
import { ArenaView } from '@/features/arena';
import { projectSearchValidator } from '@vibe/web-core/project-search';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useHostId } from '@/shared/providers/HostIdProvider';

function ArenaPage() {
  const { projectId, taskId, groupId } = useParams({
    from: '/_app/projects/$projectId_/tasks/$taskId_/arena/$groupId',
  });
  const appNavigation = useAppNavigation();
  const hostId = useHostId();

  const buildWorkspaceHref = (workspaceId: string) =>
    `/projects/${projectId}/tasks/${taskId}/${hostId ? `hosts/${hostId}/` : ''}workspaces/${workspaceId}`;

  const handleDissolved = () => {
    appNavigation.goToProjectTask(projectId, taskId);
  };

  return (
    <div className="h-full">
      <ArenaView
        key={`${hostId}:${groupId}`}
        groupId={groupId}
        buildWorkspaceHref={buildWorkspaceHref}
        onDissolved={handleDissolved}
      />
    </div>
  );
}

export const Route = createFileRoute(
  '/_app/projects/$projectId_/tasks/$taskId_/arena/$groupId'
)({
  validateSearch: projectSearchValidator,
  component: ArenaPage,
});
