import {
  AgentProviderReadiness,
  type AgentGarageEntry,
  type AgentProviderCapability,
  type AgentProviderDiagnostic,
  type AgentProviderPolicy,
  type BaseCodingAgent,
} from 'shared/types';

export type AgentProviderBlockedReason =
  | 'provider_not_ready'
  | 'provider_capability_missing';

export interface AgentProviderOption {
  executor: BaseCodingAgent;
  garageEntry: AgentGarageEntry | null;
  policy: AgentProviderPolicy | null;
  enabled: boolean;
  disabledReason: AgentProviderBlockedReason | null;
  missingCapabilities: AgentProviderCapability[];
  diagnostics: AgentProviderDiagnostic[];
}

export interface DeriveAgentProviderOptionsInput {
  garage?: readonly AgentGarageEntry[] | null;
  executors?: readonly BaseCodingAgent[] | null;
  fallbackExecutors?: readonly BaseCodingAgent[];
  requiredCapabilities?: readonly AgentProviderCapability[];
}

const READY_AGENT_PROVIDER_STATES = new Set<AgentProviderReadiness>([
  AgentProviderReadiness.READY,
  AgentProviderReadiness.INSTALLED,
  AgentProviderReadiness.DEGRADED,
]);
const EMPTY_REQUIRED_CAPABILITIES: readonly AgentProviderCapability[] = [];

function uniqueExecutors(
  executors: readonly BaseCodingAgent[]
): BaseCodingAgent[] {
  return Array.from(new Set(executors));
}

function getOrderedExecutors({
  garage,
  executors,
  fallbackExecutors = [],
}: DeriveAgentProviderOptionsInput): BaseCodingAgent[] {
  if (executors) {
    return uniqueExecutors(executors);
  }

  if (garage !== undefined && garage !== null) {
    return uniqueExecutors(garage.map((entry) => entry.executor));
  }

  return uniqueExecutors(fallbackExecutors);
}

export function isAgentProviderReady(
  readiness: AgentProviderReadiness
): boolean {
  return READY_AGENT_PROVIDER_STATES.has(readiness);
}

export function getMissingAgentProviderCapabilities(
  policy: AgentProviderPolicy | null | undefined,
  requiredCapabilities: readonly AgentProviderCapability[] = EMPTY_REQUIRED_CAPABILITIES
): AgentProviderCapability[] {
  if (!policy) return [];
  return requiredCapabilities.filter(
    (capability) => !policy.capabilities.includes(capability)
  );
}

export function getAgentProviderBlockedReason(
  policy: AgentProviderPolicy | null | undefined,
  requiredCapabilities: readonly AgentProviderCapability[] = EMPTY_REQUIRED_CAPABILITIES
): AgentProviderBlockedReason | null {
  if (!policy) return null;
  if (policy.disabled || !isAgentProviderReady(policy.readiness)) {
    return 'provider_not_ready';
  }
  if (
    getMissingAgentProviderCapabilities(policy, requiredCapabilities).length > 0
  ) {
    return 'provider_capability_missing';
  }
  return null;
}

export function getAgentProviderBlockedReasonLabel(
  reason: AgentProviderBlockedReason | null | undefined
): string | null {
  if (!reason) return null;
  if (reason === 'provider_capability_missing') {
    return 'Missing required capability';
  }
  return 'Provider not ready';
}

export function deriveAgentProviderOptions({
  garage,
  executors,
  fallbackExecutors,
  requiredCapabilities = EMPTY_REQUIRED_CAPABILITIES,
}: DeriveAgentProviderOptionsInput): AgentProviderOption[] {
  const entriesByExecutor = new Map(
    (garage ?? []).map((entry) => [entry.executor, entry])
  );

  return getOrderedExecutors({ garage, executors, fallbackExecutors }).map(
    (executor) => {
      const garageEntry = entriesByExecutor.get(executor) ?? null;
      const policy = garageEntry?.policy ?? null;
      const disabledReason = getAgentProviderBlockedReason(
        policy,
        requiredCapabilities
      );

      return {
        executor,
        garageEntry,
        policy,
        enabled: disabledReason === null,
        disabledReason,
        missingCapabilities: getMissingAgentProviderCapabilities(
          policy,
          requiredCapabilities
        ),
        diagnostics: policy?.diagnostics ?? [],
      };
    }
  );
}
