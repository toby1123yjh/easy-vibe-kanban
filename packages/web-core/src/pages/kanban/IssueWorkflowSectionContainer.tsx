import { useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useWorkflowTemplateMutations } from '@/shared/hooks/useWorkflowTemplates';
import {
  buildIssueWorkflowDraft,
  IssueWorkflowEntryCard,
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
    <IssueWorkflowEntryCard
      isCreating={isCreating}
      error={error}
      onOpenCanvas={() => void handleDesignWorkflow()}
      onRunExisting={() => void handleRunWorkflow()}
    />
  );
}
