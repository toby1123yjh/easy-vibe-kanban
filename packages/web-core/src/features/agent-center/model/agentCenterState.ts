export type AgentCenterSourceState =
  | 'loading'
  | 'error'
  | 'unavailable'
  | 'ready'
  | 'degraded';

export interface AgentCenterSourceFacts {
  hasCanonicalData: boolean;
  isLoading: boolean;
  isFetching: boolean;
  error: unknown;
  diagnosticCount?: number;
  capabilityAvailable: boolean;
}

export interface AgentCenterSourceProjection {
  state: AgentCenterSourceState;
  hasUsableData: boolean;
  isRefreshing: boolean;
  canMutate: boolean;
}

/**
 * Projects one independently refreshable Agent Center source without turning
 * a failed request into a fake empty inventory. Canonical cached data remains
 * readable after refresh failure, but the affected source fails closed for
 * writes until a successful refresh replaces it.
 */
export function projectAgentCenterSource({
  hasCanonicalData,
  isLoading,
  isFetching,
  error,
  diagnosticCount = 0,
  capabilityAvailable,
}: AgentCenterSourceFacts): AgentCenterSourceProjection {
  const failed = error != null || diagnosticCount > 0;

  if (!hasCanonicalData) {
    if (failed) {
      return {
        state: 'error',
        hasUsableData: false,
        isRefreshing: false,
        canMutate: false,
      };
    }

    if (isLoading || isFetching) {
      return {
        state: 'loading',
        hasUsableData: false,
        isRefreshing: true,
        canMutate: false,
      };
    }

    return {
      state: 'unavailable',
      hasUsableData: false,
      isRefreshing: false,
      canMutate: false,
    };
  }

  if (failed) {
    return {
      state: 'degraded',
      hasUsableData: true,
      isRefreshing: false,
      canMutate: false,
    };
  }

  if (!capabilityAvailable) {
    return {
      state: 'unavailable',
      hasUsableData: true,
      isRefreshing: isFetching,
      canMutate: false,
    };
  }

  return {
    state: 'ready',
    hasUsableData: true,
    isRefreshing: isFetching,
    canMutate: true,
  };
}

export interface AgentCenterScopeEpoch {
  identity: string;
  epoch: number;
}

export function advanceAgentCenterScope(
  current: AgentCenterScopeEpoch,
  identity: string
): AgentCenterScopeEpoch {
  if (current.identity === identity) return current;
  return { identity, epoch: current.epoch + 1 };
}

export function isAgentCenterScopeCurrent(
  expected: AgentCenterScopeEpoch,
  current: AgentCenterScopeEpoch
): boolean {
  return (
    expected.identity === current.identity && expected.epoch === current.epoch
  );
}

export function canPublishAgentCenterOperation(
  expected: AgentCenterScopeEpoch,
  current: AgentCenterScopeEpoch,
  mounted: boolean
): boolean {
  return mounted && isAgentCenterScopeCurrent(expected, current);
}

export function agentCenterScopeIdentity(
  queryScopeKey: readonly unknown[] | undefined,
  provider: string,
  tab: string
): string {
  return JSON.stringify([
    queryScopeKey ?? ['machine', 'unselected'],
    provider,
    tab,
  ]);
}
