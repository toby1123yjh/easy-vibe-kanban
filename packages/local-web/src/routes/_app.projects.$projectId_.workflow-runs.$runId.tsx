import { createFileRoute } from '@tanstack/react-router';
import { projectSearchValidator } from '@vibe/web-core/project-search';

export const Route = createFileRoute(
  '/_app/projects/$projectId_/workflow-runs/$runId'
)({
  validateSearch: projectSearchValidator,
  component: WorkflowRunRouteComponent,
});

function WorkflowRunRouteComponent() {
  const { runId } = Route.useParams();

  return (
    <div className="flex h-full flex-col bg-primary p-base">
      <h1 className="text-xl font-semibold text-high">Workflow Run</h1>
      <p className="mt-base text-normal">Run ID: {runId}</p>
      <p className="mt-half text-low">
        Workflow run view will be expanded in Phase 4.2.
      </p>
    </div>
  );
}
