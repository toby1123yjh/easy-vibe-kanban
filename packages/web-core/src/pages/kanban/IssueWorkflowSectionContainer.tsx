import { useMemo, useState } from 'react';
import { GitBranch, Loader2, Play } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useWorkflowTemplateMutations } from '@/shared/hooks/useWorkflowTemplates';
import {
  buildIssueWorkflowDraft,
  RunWorkflowDialog,
  type WorkflowWorkspaceOption,
} from '@/features/workflow';

interface IssueWorkflowSectionContainerProps {
  issueId: string;
  issueTitle: string;
  issueDescription?: string | null;
}

export function IssueWorkflowSectionContainer({
  issueId,
  issueTitle,
  issueDescription,
}: IssueWorkflowSectionContainerProps) {
  const { projectId } = useParams({ strict: false });
  const { getWorkspacesForIssue } = useProjectContext();
  const { activeWorkspaces, archivedWorkspaces } = useWorkspaceContext();
  const { createTemplate, isCreating } = useWorkflowTemplateMutations();
  const navigation = useAppNavigation();
  const [error, setError] = useState<string | null>(null);

  const localWorkspacesById = useMemo(() => {
    const map = new Map<string, (typeof activeWorkspaces)[number]>();
    for (const workspace of activeWorkspaces) {
      map.set(workspace.id, workspace);
    }
    for (const workspace of archivedWorkspaces) {
      map.set(workspace.id, workspace);
    }
    return map;
  }, [activeWorkspaces, archivedWorkspaces]);

  const workflowWorkspaces = useMemo<WorkflowWorkspaceOption[]>(
    () =>
      getWorkspacesForIssue(issueId)
        .filter((workspace) => workspace.local_workspace_id)
        .map((workspace) => {
          const localWorkspace = localWorkspacesById.get(
            workspace.local_workspace_id as string
          );
          return {
            id: workspace.local_workspace_id as string,
            label:
              workspace.name ||
              localWorkspace?.name ||
              `Workspace ${workspace.local_workspace_id}`,
            branch: localWorkspace?.branch ?? null,
          };
        }),
    [getWorkspacesForIssue, issueId, localWorkspacesById]
  );

  if (!projectId) {
    return null;
  }

  const handleRunWorkflow = async () => {
    await RunWorkflowDialog.show({
      projectId,
      issueId,
      issueTitle,
      issueDescription,
      workspaces: workflowWorkspaces,
    });
  };

  const handleDesignWorkflow = async () => {
    setError(null);
    try {
      const draft = await createTemplate({
        projectId,
        payload: buildIssueWorkflowDraft({
          title: issueTitle,
          description: issueDescription,
        }),
      });
      navigation.goToProjectWorkflowEdit(projectId, draft.id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to create workflow draft.'
      );
    }
  };

  return (
    <div className="my-half rounded border border-secondary bg-panel/70 p-half shadow-sm">
      <div className="flex items-start gap-half px-half pt-half">
        <div className="mt-[2px] flex h-7 w-7 shrink-0 items-center justify-center rounded border border-brand/30 bg-brand/10">
          <GitBranch className="h-4 w-4 text-brand" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-high">AI workflow</div>
          <p className="mt-0.5 text-xs text-low">
            Design task steps on the canvas, then run when ready.
          </p>
        </div>
      </div>

      <div className="mt-half grid grid-cols-2 gap-half">
        <button
          type="button"
          onClick={() => void handleDesignWorkflow()}
          disabled={isCreating}
          className="flex h-9 items-center justify-center gap-half rounded border border-brand/40 bg-brand/5 px-half text-sm font-medium text-high transition-colors hover:bg-brand/10 disabled:cursor-not-allowed disabled:opacity-60"
          aria-label="Design workflow"
        >
          {isCreating ? (
            <Loader2 className="h-4 w-4 animate-spin text-brand" />
          ) : (
            <GitBranch className="h-4 w-4 text-brand" />
          )}
          Design workflow
        </button>
        <button
          type="button"
          onClick={() => void handleRunWorkflow()}
          className="flex h-9 items-center justify-center gap-half rounded border border-secondary bg-primary px-half text-sm font-medium text-high transition-colors hover:border-brand/60 hover:bg-secondary/20"
          aria-label="Run workflow"
        >
          <Play className="h-4 w-4 text-brand" />
          Run
        </button>
      </div>

      {error ? (
        <p className="mt-half px-half text-xs text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
