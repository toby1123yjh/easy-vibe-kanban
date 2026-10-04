import { createFileRoute } from '@tanstack/react-router';
import { WorkflowLandingPage } from '@/features/workflow/ui/WorkflowLandingPage';

export const Route = createFileRoute('/_app/workflows')({
  validateSearch: (
    search: Record<string, unknown>
  ): { projectId?: string } => ({
    projectId:
      typeof search.projectId === 'string' ? search.projectId : undefined,
  }),
  component: WorkflowRoute,
});

function WorkflowRoute() {
  const { projectId } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <WorkflowLandingPage
      projectId={projectId}
      onProjectChange={(nextProjectId) =>
        void navigate({ search: { projectId: nextProjectId } })
      }
    />
  );
}
