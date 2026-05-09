import { createFileRoute } from '@tanstack/react-router';
import { WorkflowTemplateListPage } from '@/features/workflow';
import { projectSearchValidator } from '@vibe/web-core/project-search';

export const Route = createFileRoute('/_app/projects/$projectId_/workflows')({
  validateSearch: projectSearchValidator,
  component: WorkflowsRouteComponent,
});

function WorkflowsRouteComponent() {
  const { projectId } = Route.useParams();

  return <WorkflowTemplateListPage projectId={projectId} />;
}
