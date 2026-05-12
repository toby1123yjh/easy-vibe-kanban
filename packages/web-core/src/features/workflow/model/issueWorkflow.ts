export function buildWorkflowRunInput({
  title,
  description,
}: {
  title: string;
  description?: string | null;
}): string {
  if (description && description.trim().length > 0) {
    return `${title}\n\n${description}`;
  }
  return title;
}

export const WORKFLOW_RUN_REPOSITORY_ERROR_MESSAGE =
  'This workflow needs a workspace with at least one repository. Choose an existing workspace with repositories, or add a repository to the project before starting the run.';

export function getWorkflowRunErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Failed to start workflow run.';

  if (
    /workspace has no repositories configured/i.test(message) ||
    /project has no repositories configured/i.test(message) ||
    /no repositories provided/i.test(message)
  ) {
    return WORKFLOW_RUN_REPOSITORY_ERROR_MESSAGE;
  }

  return message;
}
