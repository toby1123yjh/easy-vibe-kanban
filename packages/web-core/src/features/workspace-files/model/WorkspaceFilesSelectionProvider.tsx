import {
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { createHmrContext } from '@/shared/lib/hmrContext';
import {
  isSameWorkspaceFileTarget,
  normalizeWorkspaceFilePath,
} from './previewTarget';
import type { WorkspaceFilePreviewTarget } from './types';

interface WorkspaceFilesSelectionContextValue {
  targetsByWorkspaceId: Record<string, WorkspaceFilePreviewTarget | null>;
  openTarget: (target: WorkspaceFilePreviewTarget) => void;
  clearTarget: (workspaceId: string) => void;
}

const WorkspaceFilesSelectionContext =
  createHmrContext<WorkspaceFilesSelectionContextValue | null>(
    'WorkspaceFilesSelectionContext',
    null
  );

interface WorkspaceFilesSelectionProviderProps {
  children: ReactNode;
}

export function WorkspaceFilesSelectionProvider({
  children,
}: WorkspaceFilesSelectionProviderProps) {
  const [targetsByWorkspaceId, setTargetsByWorkspaceId] = useState<
    Record<string, WorkspaceFilePreviewTarget | null>
  >({});

  const openTarget = useCallback((target: WorkspaceFilePreviewTarget) => {
    setTargetsByWorkspaceId((current) => ({
      ...current,
      [target.workspaceId]: {
        ...target,
        path: normalizeWorkspaceFilePath(target.path),
      },
    }));
  }, []);

  const clearTarget = useCallback((workspaceId: string) => {
    setTargetsByWorkspaceId((current) => {
      if (!(workspaceId in current)) return current;
      return {
        ...current,
        [workspaceId]: null,
      };
    });
  }, []);

  const value = useMemo(
    () => ({
      targetsByWorkspaceId,
      openTarget,
      clearTarget,
    }),
    [clearTarget, openTarget, targetsByWorkspaceId]
  );

  return (
    <WorkspaceFilesSelectionContext.Provider value={value}>
      {children}
    </WorkspaceFilesSelectionContext.Provider>
  );
}

export function useWorkspaceFilesSelection(workspaceId: string | undefined) {
  const context = useContext(WorkspaceFilesSelectionContext);
  if (!context) {
    throw new Error(
      'useWorkspaceFilesSelection must be used within WorkspaceFilesSelectionProvider'
    );
  }

  const target = workspaceId
    ? (context.targetsByWorkspaceId[workspaceId] ?? null)
    : null;

  const openTarget = useCallback(
    (nextTarget: WorkspaceFilePreviewTarget) => {
      context.openTarget(nextTarget);
    },
    [context]
  );

  const clearTarget = useCallback(() => {
    if (!workspaceId) return;
    context.clearTarget(workspaceId);
  }, [context, workspaceId]);

  const isTargetActive = useCallback(
    (candidate: WorkspaceFilePreviewTarget) =>
      isSameWorkspaceFileTarget(target, candidate),
    [target]
  );

  return {
    target,
    openTarget,
    clearTarget,
    isTargetActive,
  } as const;
}
