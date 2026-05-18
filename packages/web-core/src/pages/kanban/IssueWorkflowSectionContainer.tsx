import { useParams } from '@tanstack/react-router';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useWorkflowAttempts } from '@/shared/hooks/useWorkflowAttempts';
import {
  IssueWorkflowEntryCard,
  useCreateIssueWorkflowAttempt,
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
  const navigation = useAppNavigation();
  const {
    createWorkflowAttempt,
    isCreatingWorkflowAttempt,
    workflowCreateError,
  } = useCreateIssueWorkflowAttempt({
    issueId,
    issueTitle,
    issueDescription,
  });

  if (!projectId) {
    return null;
  }

  const handleOpenExistingCanvas = async () => {
    if (!projectId) return;
    const attempt = attemptData?.attempts[0];
    if (attempt) {
      navigation.goToProjectWorkflowEdit(projectId, attempt.workflow_id);
      return;
    }

    await createWorkflowAttempt();
  };

  const handleDesignWorkflow = async () => {
    await createWorkflowAttempt();
  };

  return (
    <IssueWorkflowEntryCard
      isCreating={isCreatingWorkflowAttempt}
      error={workflowCreateError}
      onOpenCanvas={() => void handleDesignWorkflow()}
      onRunExisting={() => void handleOpenExistingCanvas()}
    />
  );
}
