import type {
  CreateWorkflowAttemptRequest,
  DraftWorkspaceRepo,
} from 'shared/types';
import {
  createDefaultWorkflowGraph,
  instantiateWorkflowGraphTemplate,
  type WorkflowGraphDefaultLabels,
} from './workflowGraph';

export type IssueWorkflowDraftPayload = CreateWorkflowAttemptRequest & {
  repos: DraftWorkspaceRepo[];
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
  name,
  untitledTitle = 'Untitled task',
  defaultGraphLabels,
  templateGraphJson,
  repos = [],
}: {
  title: string;
  name?: string;
  untitledTitle?: string;
  description?: string | null;
  defaultGraphLabels?: Partial<WorkflowGraphDefaultLabels>;
  templateGraphJson?: string | null;
  repos?: DraftWorkspaceRepo[];
}): IssueWorkflowDraftPayload {
  const issueTitle = title.trim() || untitledTitle;
  const graph = buildIssueWorkflowDraftGraph({
    defaultGraphLabels,
    templateGraphJson,
  });

  return {
    name: name ?? `Workflow attempt for ${issueTitle}`,
    graph_json: JSON.stringify(graph),
    repos,
  };
}

function buildIssueWorkflowDraftGraph({
  defaultGraphLabels,
  templateGraphJson,
}: {
  defaultGraphLabels?: Partial<WorkflowGraphDefaultLabels>;
  templateGraphJson?: string | null;
}) {
  if (templateGraphJson) {
    try {
      return instantiateWorkflowGraphTemplate(JSON.parse(templateGraphJson));
    } catch {
      // Fall through to the localized default graph when a saved template is
      // corrupt or from an unsupported future schema.
    }
  }

  return createDefaultWorkflowGraph(defaultGraphLabels);
}

export const WORKFLOW_RUN_REPOSITORY_ERROR_MESSAGE =
  'This workflow needs a workspace with at least one repository. Choose an existing workspace with repositories, or add a repository to the project before starting the run.';

export function getWorkflowRunErrorMessage(
  error: unknown,
  options: {
    repositoryMessage?: string;
    fallbackMessage?: string;
  } = {}
): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : (options.fallbackMessage ?? 'Failed to start workflow run.');

  if (
    /workspace has no repositories configured/i.test(message) ||
    /project has no repositories configured/i.test(message) ||
    /no repositories provided/i.test(message)
  ) {
    return options.repositoryMessage ?? WORKFLOW_RUN_REPOSITORY_ERROR_MESSAGE;
  }

  return message;
}
