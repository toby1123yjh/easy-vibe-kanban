import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  AgentGarageEntry,
  AgentProviderPolicy,
  BaseCodingAgent,
} from 'shared/types';
import { agentsApi } from '@/shared/lib/api';

export const agentProviderPolicyKeys = {
  all: ['agent-provider-policy'] as const,
  garage: () => [...agentProviderPolicyKeys.all, 'garage'] as const,
};

export function useAgentProviderPolicy(
  executor: BaseCodingAgent | null | undefined
): AgentProviderPolicy | null {
  const { data: garage } = useQuery<AgentGarageEntry[]>({
    queryKey: agentProviderPolicyKeys.garage(),
    queryFn: agentsApi.getGarage,
    enabled: !!executor,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    if (!executor) return null;
    return garage?.find((entry) => entry.executor === executor)?.policy ?? null;
  }, [executor, garage]);
}
