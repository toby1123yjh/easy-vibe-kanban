import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  AgentGarageEntry,
  AgentProviderCapability,
  AgentProviderPolicy,
  BaseCodingAgent,
} from 'shared/types';
import { agentsApi } from '@/shared/lib/api';
import {
  deriveAgentProviderOptions,
  type AgentProviderOption,
} from '@/shared/lib/agentProviderOptions';

export const agentProviderPolicyKeys = {
  all: ['agent-provider-policy'] as const,
  garage: () => [...agentProviderPolicyKeys.all, 'garage'] as const,
};

const EMPTY_REQUIRED_CAPABILITIES: readonly AgentProviderCapability[] = [];

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

interface UseAgentProviderOptionsInput {
  executors?: readonly BaseCodingAgent[] | null;
  fallbackExecutors?: readonly BaseCodingAgent[];
  requiredCapabilities?: readonly AgentProviderCapability[];
  enabled?: boolean;
}

interface UseAgentProviderOptionsResult {
  options: AgentProviderOption[];
  garage: AgentGarageEntry[] | null;
  isLoading: boolean;
  isError: boolean;
}

export function useAgentProviderOptions({
  executors,
  fallbackExecutors,
  requiredCapabilities = EMPTY_REQUIRED_CAPABILITIES,
  enabled = true,
}: UseAgentProviderOptionsInput = {}): UseAgentProviderOptionsResult {
  const {
    data: garage,
    isLoading,
    isError,
  } = useQuery<AgentGarageEntry[]>({
    queryKey: agentProviderPolicyKeys.garage(),
    queryFn: agentsApi.getGarage,
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const options = useMemo(
    () =>
      deriveAgentProviderOptions({
        garage,
        executors,
        fallbackExecutors,
        requiredCapabilities,
      }),
    [executors, fallbackExecutors, garage, requiredCapabilities]
  );

  return {
    options,
    garage: garage ?? null,
    isLoading,
    isError,
  };
}
