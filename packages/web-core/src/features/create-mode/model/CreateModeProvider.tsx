import { useMemo, type ReactNode } from 'react';
import type { CreateModeInitialState } from '@/shared/types/createMode';
import { useCreateModeState } from '@/features/create-mode/model/useCreateModeState';
import { useWorkspaces } from '@/shared/hooks/useWorkspaces';
import { useCurrentAppDestination } from '@/shared/hooks/useCurrentAppDestination';
import { getDestinationHostId } from '@/shared/lib/routes/appNavigation';
import {
  CreateModeContext,
  type CreateModeContextValue,
} from '@/features/create-mode/model/useCreateMode';

interface CreateModeProviderProps {
  children: ReactNode;
  initialState?: CreateModeInitialState | null;
  draftId?: string | null;
}

export function CreateModeProvider({
  children,
  initialState,
  draftId,
}: CreateModeProviderProps) {
  // Fetch most recent workspace to seed project selection only
  const {
    workspaces: activeWorkspaces,
    archivedWorkspaces,
    isLoading: localWorkspacesLoading,
  } = useWorkspaces();
  const destination = useCurrentAppDestination();
  const hostId = useMemo(
    () => getDestinationHostId(destination),
    [destination]
  );
  const mostRecentWorkspace = activeWorkspaces[0] ?? archivedWorkspaces[0];
  const state = useCreateModeState({
    initialState,
    draftId,
    hostId,
    lastWorkspaceId: mostRecentWorkspace?.id ?? null,
    localWorkspacesLoading,
  });

  const value = useMemo<CreateModeContextValue>(
    () => ({
      repos: state.repos,
      addRepo: state.addRepo,
      removeRepo: state.removeRepo,
      clearRepos: state.clearRepos,
      targetBranches: state.targetBranches,
      setTargetBranch: state.setTargetBranch,
      directFolderPath: state.directFolderPath,
      setDirectFolderPath: state.setDirectFolderPath,
      hasResolvedInitialWorkspaceDefaults:
        state.hasResolvedInitialWorkspaceDefaults,
      preferredExecutorConfig: state.preferredExecutorConfig,
      message: state.message,
      setMessage: state.setMessage,
      clearDraft: state.clearDraft,
      hasInitialValue: state.hasInitialValue,
      linkedIssue: state.linkedIssue,
      clearLinkedIssue: state.clearLinkedIssue,
      executorConfig: state.executorConfig,
      setExecutorConfig: state.setExecutorConfig,
      attachments: state.attachments,
      setAttachments: state.setAttachments,
    }),
    [
      state.repos,
      state.addRepo,
      state.removeRepo,
      state.clearRepos,
      state.targetBranches,
      state.setTargetBranch,
      state.directFolderPath,
      state.setDirectFolderPath,
      state.hasResolvedInitialWorkspaceDefaults,
      state.preferredExecutorConfig,
      state.message,
      state.setMessage,
      state.clearDraft,
      state.hasInitialValue,
      state.linkedIssue,
      state.clearLinkedIssue,
      state.executorConfig,
      state.setExecutorConfig,
      state.attachments,
      state.setAttachments,
    ]
  );

  return (
    <CreateModeContext.Provider value={value}>
      {children}
    </CreateModeContext.Provider>
  );
}
