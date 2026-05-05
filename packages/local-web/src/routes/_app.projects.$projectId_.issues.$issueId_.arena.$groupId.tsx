import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router';
import { ArenaView } from '@/features/arena';
import { projectSearchValidator } from '@vibe/web-core/project-search';

function ArenaPage() {
  const { projectId, issueId, groupId } = useParams({
    from: '/_app/projects/$projectId_/issues/$issueId_/arena/$groupId',
  });
  const navigate = useNavigate();

  const buildWorkspaceHref = (workspaceId: string) =>
    `/projects/${projectId}/issues/${issueId}/workspaces/${workspaceId}`;

  const handleDissolved = () => {
    const target = `/projects/${projectId}/issues/${issueId}` as '/';
    void navigate({ to: target });
  };

  return (
    <div className="h-full">
      <ArenaView
        groupId={groupId}
        buildWorkspaceHref={buildWorkspaceHref}
        onDissolved={handleDissolved}
      />
    </div>
  );
}

export const Route = createFileRoute(
  '/_app/projects/$projectId_/issues/$issueId_/arena/$groupId'
)({
  validateSearch: projectSearchValidator,
  component: ArenaPage,
});
