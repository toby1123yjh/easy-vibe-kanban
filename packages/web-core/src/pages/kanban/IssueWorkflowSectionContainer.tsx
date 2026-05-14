import { useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import {
  useWorkflowAttemptMutations,
  useWorkflowAttempts,
} from '@/shared/hooks/useWorkflowAttempts';
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
  const { data: attemptData } = useWorkflowAttempts(projectId, issueId, {
    enabled: !!projectId,
  });
  const { createAttempt, isCreatingAttempt } = useWorkflowAttemptMutations();
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
    if (!projectId) return;
    setError(null);
    let attempt = attemptData?.attempts[0];
    if (!attempt) {
      attempt = await createAttempt({
        projectId,
        issueId,
        payload: buildIssueWorkflowDraft({
          title: issueTitle,
          description: issueDescription,
        }),
      });
    }
    await RunWorkflowDialog.show({
      projectId,
      issueId,
      issueTitle,
      issueDescription,
      attemptId: attempt.id,
      attemptName: attempt.name,
      workspaces: workflowWorkspaces,
    });
  };

  const handleDesignWorkflow = async () => {
    setError(null);
    try {
      const draft = await createAttempt({
        projectId,
        issueId,
        payload: buildIssueWorkflowDraft({
          title: issueTitle,
          description: issueDescription,
        }),
      });
      navigation.goToProjectWorkflowEdit(projectId, draft.workflow_id);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to create workflow draft.'
      );
    }
  };

  return (
    <IssueWorkflowEntryCard
      isCreating={isCreatingAttempt}
      error={error}
      onOpenCanvas={() => void handleDesignWorkflow()}
      onRunExisting={() => void handleRunWorkflow()}
    />
  );
}
