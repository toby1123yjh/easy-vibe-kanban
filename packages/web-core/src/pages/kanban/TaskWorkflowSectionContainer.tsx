import { useParams } from '@tanstack/react-router';
import { useAppNavigation } from '@/shared/hooks/useAppNavigation';
import { useWorkflowAttempts } from '@/shared/hooks/useWorkflowAttempts';
import {
  TaskWorkflowEntryCard,
  useCreateTaskWorkflowAttempt,
} from '@/features/workflow';

interface TaskWorkflowSectionContainerProps {
  taskId: string;
  taskTitle: string;
  taskDescription?: string | null;
}

export function TaskWorkflowSectionContainer({
  taskId,
  taskTitle,
  taskDescription,
}: TaskWorkflowSectionContainerProps) {
  const { projectId } = useParams({ strict: false });
  const { data: attemptData } = useWorkflowAttempts(projectId, taskId, {
    enabled: !!projectId,
  });
  const navigation = useAppNavigation();
  const {
    createWorkflowAttempt,
    isCreatingWorkflowAttempt,
    workflowCreateError,
  } = useCreateTaskWorkflowAttempt({
    taskId,
    taskTitle,
    taskDescription,
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
    <TaskWorkflowEntryCard
      isCreating={isCreatingWorkflowAttempt}
      error={workflowCreateError}
      onOpenCanvas={() => void handleDesignWorkflow()}
      onRunExisting={() => void handleOpenExistingCanvas()}
    />
  );
}
