import type { DraftWorkspaceRepo } from 'shared/types';
import type { WorkspaceTargetSelection } from '@/shared/dialogs/shared/WorkspaceTargetDialog';

export interface WorkflowWorkspaceInput {
  repos: DraftWorkspaceRepo[];
  directory_path?: string;
}

export function workflowWorkspaceInput(
  selection: WorkspaceTargetSelection
): WorkflowWorkspaceInput {
  return selection.mode === 'direct_folder'
    ? { repos: [], directory_path: selection.path }
    : {
        repos: [
          { repo_id: selection.repo.id, target_branch: selection.targetBranch },
        ],
      };
}

export function workflowDraftWorkspaceInput(draft: {
  repos: DraftWorkspaceRepo[];
  directoryPath?: string;
}): WorkflowWorkspaceInput {
  return draft.directoryPath?.trim()
    ? { repos: [], directory_path: draft.directoryPath.trim() }
    : { repos: draft.repos };
}
