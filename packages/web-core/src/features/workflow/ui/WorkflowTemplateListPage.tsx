import {
  useWorkflowTemplates,
  useWorkflowTemplateMutations,
} from '@/shared/hooks/useWorkflowTemplates';
import { createDefaultWorkflowGraph } from '../model/workflowGraph';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { Button } from '@vibe/ui/components/Button';
import { Loader2, Plus, FileText } from 'lucide-react';

export interface WorkflowTemplateListPageProps {
  projectId: string;
}

export function WorkflowTemplateListPage({
  projectId,
}: WorkflowTemplateListPageProps) {
  const { data, isLoading, error } = useWorkflowTemplates(projectId);
  const { createTemplate, isCreating } = useWorkflowTemplateMutations();
  const navigation = useAppNavigation();

  const handleCreate = async () => {
    const defaultGraph = createDefaultWorkflowGraph();
    const result = await createTemplate({
      projectId,
      payload: {
        name: 'New workflow',
        description: '',
        graph_json: JSON.stringify(defaultGraph),
      },
    });
    navigation.goToProjectWorkflowEdit(projectId, result.id);
  };

  const handleOpen = (workflowId: string) => {
    navigation.goToProjectWorkflowEdit(projectId, workflowId);
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-error">
        Failed to load workflows:{' '}
        {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  const templates = data?.workflows ?? [];

  return (
    <div className="flex h-full flex-col bg-primary p-base">
      <div className="mb-base flex items-center justify-between">
        <h1 className="text-xl font-semibold text-high">Workflows</h1>
        <Button
          onClick={handleCreate}
          disabled={isCreating}
          className="flex items-center gap-2"
        >
          {isCreating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Create Workflow
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-secondary bg-panel p-8 text-center text-low">
          <FileText className="mb-4 h-12 w-12 text-secondary" />
          <p>No workflows found.</p>
          <p className="text-sm">Create your first workflow to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <div
              key={template.id}
              className="flex cursor-pointer flex-col gap-2 rounded-lg border border-secondary bg-panel p-4 hover:border-brand"
              onClick={() => handleOpen(template.id)}
            >
              <div className="flex items-start justify-between">
                <h3 className="font-medium text-high">
                  {template.name || 'Untitled'}
                </h3>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    template.source === 'system'
                      ? 'bg-secondary text-normal'
                      : 'bg-brand/10 text-brand'
                  }`}
                >
                  {template.source}
                </span>
              </div>
              <p className="line-clamp-2 text-sm text-low">
                {template.description || 'No description provided.'}
              </p>
              <div className="mt-auto pt-2 text-xs text-low">
                Updated {new Date(template.updated_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
