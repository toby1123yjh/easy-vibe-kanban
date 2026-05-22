import { useCallback, useMemo } from 'react';
import { useProjectContext } from '@/shared/hooks/useProjectContext';
import { useUserContext } from '@/shared/hooks/useUserContext';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { saveProjectRepoDefaults } from '@/shared/hooks/useProjectRepoDefaults';
import {
  getExplicitProjectWorkspaceDefaults,
  getWorkspaceDefaults,
} from '@/shared/lib/workspaceDefaults';
import {
  buildLinkedIssueCreateState,
  buildLocalWorkspaceIdSet,
  buildWorkspaceCreateInitialState,
} from '@/shared/lib/workspaceCreateState';
import type { DraftWorkspaceRepo } from 'shared/types';
import { WorkflowRepositoryDialog } from './WorkflowRepositoryDialog';

interface UseWorkflowRepositorySelectionOptions {
  projectId?: string | null;
  issueId: string;
  issueTitle: string;
}

export function useWorkflowRepositorySelection({
  projectId,
  issueId,
  issueTitle,
}: UseWorkflowRepositorySelectionOptions) {
  const { getIssue } = useProjectContext();
  const { workspaces } = useUserContext();
  const { activeWorkspaces, archivedWorkspaces } = useWorkspaceContext();

  const localWorkspaceIds = useMemo(
    () => buildLocalWorkspaceIdSet(activeWorkspaces, archivedWorkspaces),
    [activeWorkspaces, archivedWorkspaces]
  );

  const selectWorkflowRepositories = useCallback(async (): Promise<
    DraftWorkspaceRepo[] | null
  > => {
    if (!projectId) return null;

    const explicitProjectDefaults = await getExplicitProjectWorkspaceDefaults(
      projectId
    ).catch(() => null);
    if (explicitProjectDefaults?.preferredRepos.length) {
      return explicitProjectDefaults.preferredRepos.map((repo) => ({
        repo_id: repo.repo_id,
        target_branch: repo.target_branch ?? '',
      }));
    }

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

    await saveProjectRepoDefaults(projectId, result.repos).catch(
      () => undefined
    );

    return result.repos;
  }, [projectId, getIssue, issueId, issueTitle, workspaces, localWorkspaceIds]);

  return { selectWorkflowRepositories };
}
