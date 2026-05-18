import { useCallback, useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useUserContext } from '@/shared/hooks/useUserContext';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { saveProjectRepoDefaults } from '@/shared/hooks/useProjectRepoDefaults';
import { getWorkspaceDefaults } from '@/shared/lib/workspaceDefaults';
import {
  buildLinkedIssueCreateState,
  buildLocalWorkspaceIdSet,
  buildWorkspaceCreateInitialState,
} from '@/shared/lib/workspaceCreateState';
import { useWorkflowAttemptMutations } from '@/shared/hooks/useWorkflowAttempts';
import { buildIssueWorkflowDraft } from '../model/issueWorkflow';
import { WorkflowRepositoryDialog } from './WorkflowRepositoryDialog';

interface UseCreateIssueWorkflowAttemptOptions {
  issueId: string;
  issueTitle: string;
  issueDescription?: string | null;
}

export function useCreateIssueWorkflowAttempt({
  issueId,
  issueTitle,
  issueDescription,
}: UseCreateIssueWorkflowAttemptOptions) {
  const { projectId } = useParams({ strict: false });
  const navigation = useAppNavigation();
  const { getIssue } = useProjectContext();
  const { workspaces } = useUserContext();
  const { activeWorkspaces, archivedWorkspaces } = useWorkspaceContext();
  const { createAttempt, isCreatingAttempt } = useWorkflowAttemptMutations();
  const [error, setError] = useState<string | null>(null);

  const localWorkspaceIds = useMemo(
    () => buildLocalWorkspaceIdSet(activeWorkspaces, archivedWorkspaces),
    [activeWorkspaces, archivedWorkspaces]
  );

  const createWorkflowAttempt = useCallback(async () => {
    if (!projectId || isCreatingAttempt) {
      return null;
    }

    setError(null);
    try {
      const issue = getIssue(issueId);
      const defaults = await getWorkspaceDefaults(
        workspaces,
        localWorkspaceIds,
        projectId
      );
      const linkedIssue = issue
        ? buildLinkedIssueCreateState(issue, projectId)
        : {
            issueId,
            title: issueTitle,
            remoteProjectId: projectId,
          };

      const result = await WorkflowRepositoryDialog.show({
        draftId: crypto.randomUUID(),
        initialState: buildWorkspaceCreateInitialState({
          prompt: null,
          defaults,
          linkedIssue,
        }),
      });

      if (result.kind === 'canceled') {
        return null;
      }

      await saveProjectRepoDefaults(projectId, result.repos);
      const draft = await createAttempt({
        projectId,
        issueId,
        payload: buildIssueWorkflowDraft({
          title: issueTitle,
          description: issueDescription,
        }),
      });
      navigation.goToProjectWorkflowEdit(projectId, draft.workflow_id);
      return draft;
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to create workflow draft.'
      );
      return null;
    }
  }, [
    projectId,
    isCreatingAttempt,
    getIssue,
    issueId,
    workspaces,
    localWorkspaceIds,
    issueTitle,
    issueDescription,
    createAttempt,
    navigation,
  ]);

  return {
    createWorkflowAttempt,
    isCreatingWorkflowAttempt: isCreatingAttempt,
    workflowCreateError: error,
  };
}
