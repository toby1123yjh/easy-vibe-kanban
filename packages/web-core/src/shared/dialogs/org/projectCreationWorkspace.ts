import type { WorkspaceTargetSelection } from '@/shared/dialogs/shared/WorkspaceTargetDialog';
import type { SettingsHostTarget } from '@/shared/dialogs/settings/settings/SettingsHostContext';
import type { ProjectWorkspaceDefault } from '@/shared/hooks/useProjectRepoDefaults';

export function canUseProjectCreationHost(
  host: SettingsHostTarget | null,
  expectedId?: string
): boolean {
  return (
    !!host &&
    (!expectedId || host.id === expectedId) &&
    (host.kind === 'local' || host.status === 'online')
  );
}

export function workspaceSelectionDefault(
  selection: WorkspaceTargetSelection
): ProjectWorkspaceDefault {
  return selection.mode === 'worktree'
    ? {
        kind: 'git',
        repo: {
          repo_id: selection.repo.id,
          target_branch: selection.targetBranch,
        },
      }
    : { kind: 'direct_folder', path: selection.path };
}
