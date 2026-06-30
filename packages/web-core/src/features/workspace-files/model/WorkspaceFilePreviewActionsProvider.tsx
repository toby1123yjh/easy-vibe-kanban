import { useCallback, useContext, useMemo, type ReactNode } from 'react';
import { createHmrContext } from '@/shared/lib/hmrContext';
import type { WorkspaceFilePreviewTarget } from './types';

interface WorkspaceFilePreviewActionsContextValue {
  canOpenWorkspaceFilePreview: boolean;
  openWorkspaceFilePreview: (target: WorkspaceFilePreviewTarget) => void;
}

const noop = () => {};

const fallbackContextValue: WorkspaceFilePreviewActionsContextValue = {
  canOpenWorkspaceFilePreview: false,
  openWorkspaceFilePreview: noop,
};

const WorkspaceFilePreviewActionsContext =
  createHmrContext<WorkspaceFilePreviewActionsContextValue>(
    'WorkspaceFilePreviewActionsContext',
    fallbackContextValue
  );

interface WorkspaceFilePreviewActionsProviderProps {
  children: ReactNode;
  onOpenWorkspaceFilePreview: (target: WorkspaceFilePreviewTarget) => void;
  enabled?: boolean;
}

export function WorkspaceFilePreviewActionsProvider({
  children,
  onOpenWorkspaceFilePreview,
  enabled = true,
}: WorkspaceFilePreviewActionsProviderProps) {
  const openWorkspaceFilePreview = useCallback(
    (target: WorkspaceFilePreviewTarget) => {
      if (!enabled) return;
      onOpenWorkspaceFilePreview(target);
    },
    [enabled, onOpenWorkspaceFilePreview]
  );

  const value = useMemo(
    () => ({
      canOpenWorkspaceFilePreview: enabled,
      openWorkspaceFilePreview,
    }),
    [enabled, openWorkspaceFilePreview]
  );

  return (
    <WorkspaceFilePreviewActionsContext.Provider value={value}>
      {children}
    </WorkspaceFilePreviewActionsContext.Provider>
  );
}

export function useWorkspaceFilePreviewActions() {
  return useContext(WorkspaceFilePreviewActionsContext);
}
