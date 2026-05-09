import { useMemo } from 'react';
import { Play } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import {
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

  return (
    <div className="my-half">
      <button
        type="button"
        onClick={() => void handleRunWorkflow()}
        className="flex w-full items-center justify-between rounded border border-brand/40 bg-brand/5 px-base py-half text-sm hover:bg-brand/10"
        aria-label="Run workflow"
      >
        <span className="flex items-center gap-half font-medium text-high">
          <Play className="h-4 w-4 text-brand" />
          Run AI workflow
        </span>
        <span className="text-xs text-low">Choose template</span>
      </button>
    </div>
  );
}
