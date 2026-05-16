import { useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import {
  useWorkflowAttemptMutations,
  useWorkflowAttempts,
} from '@/shared/hooks/useWorkflowAttempts';
import {
  buildIssueWorkflowDraft,
  IssueWorkflowEntryCard,
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
  const { data: attemptData } = useWorkflowAttempts(projectId, issueId, {
    enabled: !!projectId,
  });
  const { createAttempt, isCreatingAttempt } = useWorkflowAttemptMutations();
  const navigation = useAppNavigation();
  const [error, setError] = useState<string | null>(null);

  if (!projectId) {
    return null;
  }

  const handleOpenExistingCanvas = async () => {
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
    navigation.goToProjectWorkflowEdit(projectId, attempt.workflow_id);
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
      onRunExisting={() => void handleOpenExistingCanvas()}
    />
  );
}
