import { useCallback, useState } from 'react';
import {
  isSameWorkspaceFileTarget,
  normalizeWorkspaceFilePath,
} from './previewTarget';
import type { WorkspaceFilePreviewTarget } from './types';

export function useWorkspaceFilePreviewState(
  initialTarget: WorkspaceFilePreviewTarget | null = null
) {
  const [target, setTarget] = useState<WorkspaceFilePreviewTarget | null>(
    initialTarget
  );

  const openTarget = useCallback((nextTarget: WorkspaceFilePreviewTarget) => {
    setTarget({
      ...nextTarget,
      path: normalizeWorkspaceFilePath(nextTarget.path),
    });
  }, []);

  const clearTarget = useCallback(() => {
    setTarget(null);
  }, []);

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
