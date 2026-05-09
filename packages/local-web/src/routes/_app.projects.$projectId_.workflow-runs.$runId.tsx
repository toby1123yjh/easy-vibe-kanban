import { createFileRoute } from '@tanstack/react-router';
import { projectSearchValidator } from '@vibe/web-core/project-search';
import { WorkflowRunPage } from '@/features/workflow';

export const Route = createFileRoute(
  '/_app/projects/$projectId_/workflow-runs/$runId'
)({
  validateSearch: projectSearchValidator,
  component: WorkflowRunRouteComponent,
});

function WorkflowRunRouteComponent() {
  const { projectId, runId } = Route.useParams();

  return <WorkflowRunPage projectId={projectId} runId={runId} />;
}
