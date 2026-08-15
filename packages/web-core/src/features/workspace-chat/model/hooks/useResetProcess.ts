import { useCallback, useMemo } from 'react';

export interface UseResetProcessResult {
  resetProcess: (executionProcessId: string) => void;
  canResetProcess: (executionProcessId: string) => boolean;
  isResetPending: boolean;
}

/**
 * @param workspaceId - passed explicitly to avoid subscribing to WorkspaceContext
 * @param selectedSessionId - passed explicitly to avoid subscribing to WorkspaceContext
 */
export function useResetProcess(
  _workspaceId: string | undefined,
  _selectedSessionId: string | undefined
): UseResetProcessResult {
  // Agent runs are reset through the canonical AgentRun control API. The
  // legacy execution-process reset route is intentionally unavailable. A
  // caller must use the canonical AgentRun retry/control APIs with an
  // AgentRun identity instead of an ExecutionProcess id.
  const canResetProcess = useCallback(
    (_executionProcessId: string) => false,
    []
  );
  const resetProcess = useCallback((_executionProcessId: string) => {}, []);

  return useMemo(
    () => ({
      resetProcess,
      canResetProcess,
      isResetPending: false,
    }),
    [resetProcess, canResetProcess]
  );
}
