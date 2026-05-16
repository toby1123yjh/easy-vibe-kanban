import type { CreateWorkflowRequest } from 'shared/types';
import { createDefaultWorkflowGraph } from './workflowGraph';

export const ISSUE_WORKFLOW_ENTRY_COPY = {
  title: 'Workflow attempt',
  subtitle: 'Design the task attempt before running agents',
  primaryActionLabel: 'Open canvas',
  primaryActionAriaLabel: 'Open workflow attempt canvas',
  secondaryActionLabel: 'Open canvas',
  secondaryActionAriaLabel: 'Open workflow attempt canvas',
};

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

export function buildIssueWorkflowDraft({
  title,
}: {
  title: string;
  description?: string | null;
}): CreateWorkflowRequest {
  const issueTitle = title.trim() || 'Untitled task';

  return {
    name: `Workflow attempt for ${issueTitle}`,
    description:
      'Issue-bound workflow task attempt. Design the canvas before starting the run.',
    graph_json: JSON.stringify(createDefaultWorkflowGraph()),
  };
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
