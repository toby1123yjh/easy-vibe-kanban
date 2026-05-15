import { createFileRoute } from '@tanstack/react-router';
import { WorkflowTemplateEditorPage } from '@/features/workflow';
import { projectSearchValidator } from '@vibe/web-core/project-search';
import { ProjectProvider } from '@/shared/providers/remote/ProjectProvider';

export const Route = createFileRoute(
  '/_app/projects/$projectId_/workflows_/$workflowId/edit'
)({
  validateSearch: projectSearchValidator,
  component: WorkflowEditRouteComponent,
});

function WorkflowEditRouteComponent() {
  const { projectId, workflowId } = Route.useParams();

  return (
    <ProjectProvider projectId={projectId}>
      <WorkflowTemplateEditorPage
        projectId={projectId}
        workflowId={workflowId}
      />
    </ProjectProvider>
  );
}
