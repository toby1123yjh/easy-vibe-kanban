import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AgentProviderCapability,
  AgentProviderReadiness,
  AgentSettingsProvider,
  BaseCodingAgent,
  type AgentGarageEntry,
} from 'shared/types';
import {
  AGENT_PROVIDERS,
  AGENT_PROVIDER_BY_EXECUTOR,
  agentProviderForSettings,
  agentExecutorFromSearch,
} from './agentProviders';
import { deriveAgentProviderOptions } from './agentProviderOptions';
import { PROVIDER_BY_EXECUTOR, PROVIDER_LABELS } from './agentSettingsModel';

test('all six executors have distinct native settings, tool and command IDs', () => {
  assert.equal(AGENT_PROVIDERS.length, 6);
  assert.deepEqual(
    AGENT_PROVIDERS.map((provider) => provider.executor).sort(),
    Object.values(BaseCodingAgent).sort()
  );
  assert.deepEqual(
    AGENT_PROVIDERS.map((provider) => provider.settingsProvider).sort(),
    Object.values(AgentSettingsProvider).sort()
  );
  for (const provider of AGENT_PROVIDERS) {
    assert.equal(AGENT_PROVIDER_BY_EXECUTOR[provider.executor], provider);
    assert.equal(agentProviderForSettings(provider.settingsProvider), provider);
    assert.equal(
      PROVIDER_BY_EXECUTOR[provider.executor],
      provider.settingsProvider
    );
    assert.equal(PROVIDER_LABELS[provider.settingsProvider], provider.label);
    assert.equal(provider.toolProvider, provider.settingsProvider);
    assert.equal(provider.commandProvider, provider.settingsProvider);
  }
});

test('new providers retain their own IDs and the DSH preview designation', () => {
  assert.equal(
    agentProviderForSettings(AgentSettingsProvider.opencode).executor,
    BaseCodingAgent.OPENCODE
  );
  const dsh = agentProviderForSettings(AgentSettingsProvider.deepseek_harness);
  assert.equal(dsh.executor, BaseCodingAgent.DEEPSEEK_HARNESS);
  assert.equal(dsh.developerPreview, true);
});

test('provider search links resolve labels and native IDs without inventing a provider', () => {
  for (const provider of AGENT_PROVIDERS) {
    assert.equal(agentExecutorFromSearch(provider.label), provider.executor);
    assert.equal(
      agentExecutorFromSearch(provider.settingsProvider),
      provider.executor
    );
    assert.equal(agentExecutorFromSearch(provider.executor), provider.executor);
  }
  assert.equal(agentExecutorFromSearch('unknown-agent'), undefined);
  assert.equal(agentExecutorFromSearch(['opencode']), undefined);
});

test('six providers are selectable for Nodes, Routers and Main Agents when capabilities permit', () => {
  const garage = AGENT_PROVIDERS.map(({ executor }) =>
    garageEntry(executor, AgentProviderReadiness.READY, [
      AgentProviderCapability.INITIAL_RUN,
      AgentProviderCapability.WORKFLOW_AGENT_STEP,
      AgentProviderCapability.FOLLOW_UP,
      AgentProviderCapability.MCP,
    ])
  );
  for (const requiredCapabilities of [
    [
      AgentProviderCapability.INITIAL_RUN,
      AgentProviderCapability.WORKFLOW_AGENT_STEP,
    ],
    [
      AgentProviderCapability.INITIAL_RUN,
      AgentProviderCapability.FOLLOW_UP,
      AgentProviderCapability.MCP,
    ],
  ]) {
    const options = deriveAgentProviderOptions({
      garage,
      requiredCapabilities,
    });
    assert.equal(options.length, 6);
    assert.ok(options.every((option) => option.enabled));
  }
});

function garageEntry(
  executor: BaseCodingAgent,
  readiness: AgentProviderReadiness,
  capabilities: AgentProviderCapability[]
): AgentGarageEntry {
  return {
    executor,
    availability: { type: 'INSTALLATION_FOUND' },
    capabilities: [],
    policy: {
      executor,
      readiness,
      capabilities,
      legacy: false,
      disabled: false,
      diagnostics: [],
    },
  };
}

test('new session and workflow selectors use live readiness and capabilities', () => {
  const garage = [
    garageEntry(BaseCodingAgent.OPENCODE, AgentProviderReadiness.INSTALLED, [
      AgentProviderCapability.INITIAL_RUN,
      AgentProviderCapability.WORKFLOW_AGENT_STEP,
    ]),
    garageEntry(
      BaseCodingAgent.DEEPSEEK_HARNESS,
      AgentProviderReadiness.READY,
      [AgentProviderCapability.INITIAL_RUN]
    ),
  ];
  const sessions = deriveAgentProviderOptions({
    garage,
    requiredCapabilities: [AgentProviderCapability.INITIAL_RUN],
  });
  assert.deepEqual(
    sessions.map((option) => option.enabled),
    [true, true]
  );
  const workflows = deriveAgentProviderOptions({
    garage,
    requiredCapabilities: [AgentProviderCapability.WORKFLOW_AGENT_STEP],
  });
  assert.deepEqual(
    workflows.map((option) => option.enabled),
    [true, false]
  );
  assert.equal(workflows[1].disabledReason, 'provider_capability_missing');
});

test('an installed provider requiring authentication is not marked ready', () => {
  const options = deriveAgentProviderOptions({
    garage: [
      garageEntry(
        BaseCodingAgent.DEEPSEEK_HARNESS,
        AgentProviderReadiness.AUTH_REQUIRED,
        [AgentProviderCapability.INITIAL_RUN]
      ),
    ],
    requiredCapabilities: [AgentProviderCapability.INITIAL_RUN],
  });
  assert.equal(options[0].enabled, false);
  assert.equal(options[0].disabledReason, 'provider_not_ready');
});
