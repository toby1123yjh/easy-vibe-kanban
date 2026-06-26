import { describe, expect, it } from 'vitest';
import {
  AgentProviderCapability,
  AgentProviderReadiness,
  BaseCodingAgent,
  type AgentGarageEntry,
  type AgentProviderPolicy,
} from 'shared/types';
import {
  deriveAgentProviderOptions,
  getAgentProviderBlockedReason,
  isAgentProviderReady,
} from './agentProviderOptions';

function makePolicy(
  overrides: Partial<AgentProviderPolicy> = {}
): AgentProviderPolicy {
  return {
    executor: BaseCodingAgent.CODEX,
    readiness: AgentProviderReadiness.READY,
    capabilities: [AgentProviderCapability.INITIAL_RUN],
    legacy: false,
    disabled: false,
    diagnostics: [],
    ...overrides,
  };
}

function makeGarageEntry(
  executor: BaseCodingAgent,
  policy?: AgentProviderPolicy
): AgentGarageEntry {
  const entry: AgentGarageEntry = {
    executor,
    availability: { type: 'INSTALLATION_FOUND' },
    capabilities: [],
  };

  if (policy) {
    entry.policy = policy;
  }

  return entry;
}

describe('agent provider options', () => {
  it('enables ready providers with the required capability', () => {
    const options = deriveAgentProviderOptions({
      garage: [
        makeGarageEntry(
          BaseCodingAgent.CODEX,
          makePolicy({ executor: BaseCodingAgent.CODEX })
        ),
      ],
      requiredCapabilities: [AgentProviderCapability.INITIAL_RUN],
    });

    expect(options).toHaveLength(1);
    expect(options[0].executor).toBe(BaseCodingAgent.CODEX);
    expect(options[0].enabled).toBe(true);
    expect(options[0].disabledReason).toBeNull();
  });

  it('disables providers that are not ready', () => {
    const reason = getAgentProviderBlockedReason(
      makePolicy({
        readiness: AgentProviderReadiness.MISSING_EXECUTABLE,
      }),
      [AgentProviderCapability.INITIAL_RUN]
    );

    expect(reason).toBe('provider_not_ready');
    expect(isAgentProviderReady(AgentProviderReadiness.DEGRADED)).toBe(true);
    expect(isAgentProviderReady(AgentProviderReadiness.AUTH_REQUIRED)).toBe(
      false
    );
  });

  it('disables providers missing a required capability', () => {
    const options = deriveAgentProviderOptions({
      garage: [
        makeGarageEntry(
          BaseCodingAgent.CODEX,
          makePolicy({
            capabilities: [AgentProviderCapability.FOLLOW_UP],
          })
        ),
      ],
      requiredCapabilities: [AgentProviderCapability.INITIAL_RUN],
    });

    expect(options[0].enabled).toBe(false);
    expect(options[0].disabledReason).toBe('provider_capability_missing');
    expect(options[0].missingCapabilities).toEqual([
      AgentProviderCapability.INITIAL_RUN,
    ]);
  });

  it('preserves compatibility when provider policy is absent', () => {
    const options = deriveAgentProviderOptions({
      garage: [makeGarageEntry(BaseCodingAgent.CODEX)],
      requiredCapabilities: [AgentProviderCapability.INITIAL_RUN],
    });

    expect(options[0].policy).toBeNull();
    expect(options[0].enabled).toBe(true);
  });

  it('uses fallback executors only before garage data is available', () => {
    const fallbackOptions = deriveAgentProviderOptions({
      garage: undefined,
      fallbackExecutors: [BaseCodingAgent.CODEX, BaseCodingAgent.GEMINI],
    });
    const garageOptions = deriveAgentProviderOptions({
      garage: [makeGarageEntry(BaseCodingAgent.CLAUDE_CODE)],
      fallbackExecutors: [BaseCodingAgent.CODEX, BaseCodingAgent.GEMINI],
    });

    expect(fallbackOptions.map((option) => option.executor)).toEqual([
      BaseCodingAgent.CODEX,
      BaseCodingAgent.GEMINI,
    ]);
    expect(garageOptions.map((option) => option.executor)).toEqual([
      BaseCodingAgent.CLAUDE_CODE,
    ]);
  });

  it('preserves explicit executor order when provided', () => {
    const options = deriveAgentProviderOptions({
      executors: [BaseCodingAgent.GEMINI, BaseCodingAgent.CODEX],
      garage: [
        makeGarageEntry(
          BaseCodingAgent.CODEX,
          makePolicy({ executor: BaseCodingAgent.CODEX })
        ),
      ],
      requiredCapabilities: [AgentProviderCapability.INITIAL_RUN],
    });

    expect(options.map((option) => option.executor)).toEqual([
      BaseCodingAgent.GEMINI,
      BaseCodingAgent.CODEX,
    ]);
    expect(options[0].policy).toBeNull();
    expect(options[1].policy?.executor).toBe(BaseCodingAgent.CODEX);
  });
});
