import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useUserContext } from '@/shared/hooks/useUserContext';
import { useWorkspaceContext } from '@/shared/hooks/useWorkspaceContext';
import { useCurrentKanbanRouteState } from '@/shared/hooks/useCurrentKanbanRouteState';
import { saveProjectWorkspaceDefault } from '@/shared/hooks/useProjectRepoDefaults';
import { getWorkspaceDefaults } from '@/shared/lib/workspaceDefaults';
import { buildLocalWorkspaceIdSet } from '@/shared/lib/workspaceCreateState';
import { repoApi } from '@/shared/lib/api';
import {
  workflowWorkspaceInput,
  type WorkflowWorkspaceInput,
} from '../model/workflowWorkspaceSelection';
import { WorkspaceTargetDialog } from '@/shared/dialogs/shared/WorkspaceTargetDialog';

interface UseWorkflowRepositorySelectionOptions {
  projectId?: string | null;
  issueId: string;
  issueTitle: string;
}

export function useWorkflowRepositorySelection({
  projectId,
}: UseWorkflowRepositorySelectionOptions) {
  const { t } = useTranslation('common');
  const { workspaces } = useUserContext();
  const { activeWorkspaces, archivedWorkspaces } = useWorkspaceContext();
  const routeState = useCurrentKanbanRouteState();
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const ownerRef = useRef({ projectId, hostId: routeState.hostId });
  ownerRef.current = { projectId, hostId: routeState.hostId };

  const localWorkspaceIds = useMemo(
    () => buildLocalWorkspaceIdSet(activeWorkspaces, archivedWorkspaces),
    [activeWorkspaces, archivedWorkspaces]
  );

  const selectWorkflowRepositories =
    useCallback(async (): Promise<WorkflowWorkspaceInput | null> => {
      if (!projectId) return null;
      const owner = ownerRef.current;
      const isCurrentOwner = () =>
        mountedRef.current &&
        owner.projectId === ownerRef.current.projectId &&
        owner.hostId === ownerRef.current.hostId;

      const defaults = await getWorkspaceDefaults(
        workspaces,
        localWorkspaceIds,
        projectId,
        routeState.hostId
      );
      const preferredRepo = defaults?.preferredRepos[0];
      const preferredRepoDetails = preferredRepo
        ? await repoApi
            .getById(preferredRepo.repo_id, routeState.hostId)
            .catch(() => null)
        : null;

      if (!isCurrentOwner()) return null;
      const result = await WorkspaceTargetDialog.show({
        initialPath:
          defaults?.preferredDirectoryPath ?? preferredRepoDetails?.path,
        initialMode: defaults?.preferredDirectoryPath
          ? 'direct_folder'
          : 'worktree',
        initialBranch: preferredRepo?.target_branch,
        hostId: routeState.hostId,
        title: t('workflow.workspaceDialog.title', {
          defaultValue: 'Choose workflow workspace',
        }),
        description: t('workflow.workspaceDialog.description', {
          defaultValue:
            'Choose a working folder, or a Git repository and base branch for an isolated worktree.',
        }),
      });

      if (result.kind === 'canceled' || !isCurrentOwner()) {
        return null;
      }

      const workspace = workflowWorkspaceInput(result.selection);

      await saveProjectWorkspaceDefault(
        projectId,
        result.selection.mode === 'direct_folder'
          ? { kind: 'direct_folder', path: result.selection.path }
          : { kind: 'git', repo: workspace.repos[0]! },
        routeState.hostId
      ).catch(() => undefined);

      return isCurrentOwner() ? workspace : null;
    }, [projectId, routeState.hostId, t, workspaces, localWorkspaceIds]);

  return { selectWorkflowRepositories };
}
