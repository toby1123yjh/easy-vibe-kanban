import * as React from 'react';
import {
  AgentProviderCapability,
  AgentProviderReadiness,
  AgentSettingsProvider,
  BaseCodingAgent,
} from 'shared/types';

const providers = [
  BaseCodingAgent.CODEX,
  BaseCodingAgent.CLAUDE_CODE,
  BaseCodingAgent.GEMINI,
  BaseCodingAgent.OH_MY_PI,
];

const settingsProviderFor = (executor: BaseCodingAgent) => {
  switch (executor) {
    case BaseCodingAgent.CLAUDE_CODE:
      return AgentSettingsProvider.claude_code;
    case BaseCodingAgent.GEMINI:
      return AgentSettingsProvider.gemini;
    case BaseCodingAgent.OH_MY_PI:
      return AgentSettingsProvider.oh_my_pi;
    default:
      return AgentSettingsProvider.codex;
  }
};

const garage = providers.map((executor) => ({
  executor,
  availability: { type: 'INSTALLATION_FOUND' as const },
  capabilities: [
    AgentProviderCapability.INITIAL_RUN,
    AgentProviderCapability.FOLLOW_UP,
    AgentProviderCapability.MCP,
  ],
  policy: {
    executor,
    readiness: AgentProviderReadiness.READY,
    capabilities: [
      AgentProviderCapability.INITIAL_RUN,
      AgentProviderCapability.FOLLOW_UP,
      AgentProviderCapability.MCP,
    ],
    legacy: false,
    disabled: false,
    diagnostics: [],
  },
}));

const toolProviders = providers.map((executor) => {
  const provider =
    executor === BaseCodingAgent.CLAUDE_CODE
      ? 'claude_code'
      : executor === BaseCodingAgent.GEMINI
        ? 'gemini'
        : executor === BaseCodingAgent.OH_MY_PI
          ? 'oh_my_pi'
          : 'codex';
  return { provider, installed: true, items: [], limitations: [], errors: [] };
});

const commandProviders = toolProviders.map((entry) => ({
  ...entry,
  capabilities: {
    discoverable: true,
    creatable: true,
    supported_scopes: ['user', 'project'],
    writable_formats: ['codex_legacy_markdown', 'claude_markdown'],
  },
}));

function settingsSnapshot(provider: AgentSettingsProvider) {
  return {
    provider,
    installed: true,
    provider_version: 'fixture-1.0',
    schema_revision: 'fixture-revision',
    capabilities: {
      readable: true,
      native_writable: true,
      profile_storage: true,
      per_run_overrides: true,
    },
    descriptors: [],
    native_files: [],
    effective_settings: [
      {
        key: { namespace: 'common', name: 'model' },
        sources: [],
        effective_value: 'gpt-5.6-codex-long-context',
        effective_source: 'native_user',
        configured: true,
        warnings: [],
      },
      {
        key: { namespace: 'common', name: 'api_address' },
        sources: [],
        effective_value:
          'https://api.fixture.example.com/v1/agent-runtime/configuration',
        effective_source: 'native_user',
        configured: true,
        warnings: [],
      },
    ],
    unknown_native_nodes: [],
    limitations: [],
    errors: [],
  };
}

const settingsInventory = {
  providers: providers.map((executor) =>
    settingsSnapshot(settingsProviderFor(executor))
  ),
  errors: [],
};

export const machineClient = {
  target: {
    kind: 'local' as const,
    id: 'local' as const,
    apiHostId: null,
    label: 'This machine',
  },
  queryScopeKey: ['machine', 'local'] as const,
  getAgentGarage: async () => garage,
  listAgentTools: async () => ({ providers: toolProviders, errors: [] }),
  listAgentCommands: async () => ({ providers: commandProviders, errors: [] }),
  discoverAgentSettings: async () => settingsInventory,
  listAgentSettingsProfiles: async () => [],
  getConfig: async () => ({ config: configValue }),
  saveConfig: async (config: unknown) => config,
  // The remaining methods are only exercised by the detail tabs. Keeping
  // them available makes the mock a complete MachineClient boundary.
  updateAndSaveConfig: async () => true,
};

const configValue = {
  config_version: 'fixture',
  theme: 'system',
  executor_profile: { executor: BaseCodingAgent.CODEX, variant: null },
  disclaimer_acknowledged: true,
  onboarding_acknowledged: true,
  remote_onboarding_acknowledged: true,
  notifications: {},
  editor: {},
  github: {},
  analytics_enabled: false,
  workspace_dir: null,
  last_app_version: null,
  show_release_notes: false,
  language: 'en',
  git_branch_prefix: '',
  showcases: {},
  pr_auto_description_enabled: false,
  pr_auto_description_prompt: null,
  commit_reminder_enabled: false,
  commit_reminder_prompt: null,
  send_message_shortcut: 'enter',
  relay_enabled: false,
  host_nickname: null,
  hidden_agents: [],
};

export function useSettingsHost() {
  return {
    availableHosts: [
      machineClient.target,
      {
        kind: 'remote' as const,
        id: 'remote-fixture',
        apiHostId: 'remote-fixture',
        label: 'Remote fixture',
        status: 'online' as const,
      },
    ],
    hostsResolved: true,
    hostDiscovery: {
      hasCanonicalData: true,
      isLoading: false,
      isRetrying: false,
      error: null,
      canRetry: true,
      retry: async () => undefined,
    },
    selectedHostId: 'local',
    selectedHost: machineClient.target,
    setSelectedHostId: () => undefined,
  };
}

export function useSettingsMachineClient() {
  return machineClient as never;
}

export function useSettingsDirty() {
  return {
    isDirty: false,
    setDirty: () => undefined,
    clearAll: () => undefined,
  };
}

export function useSettingsMachineState() {
  return {
    hasCanonicalData: true,
    isLoading: false,
    isRetrying: false,
    error: null,
    canMutate: true,
    retry: async () => undefined,
  };
}

export function useUserSystem() {
  return {
    config: configValue,
    updateAndSaveConfig: async () => true,
  };
}

export function useBlocker() {
  return {
    status: 'unblocked' as const,
    proceed: () => undefined,
    reset: () => undefined,
  };
}

export function useLocation() {
  return { pathname: '/' };
}

export function AgentIcon({ agent }: { agent: BaseCodingAgent }) {
  return <span aria-hidden="true" data-agent-icon={agent} />;
}

export function AgentConfigurationSettingsPanel() {
  return <div data-testid="configuration-panel" />;
}

export function AgentToolsSettingsSection() {
  return <div data-testid="tools-panel" />;
}

export function AgentCommandsSettingsSection() {
  return <div data-testid="commands-panel" />;
}

export function LoadingState({ title }: { title: React.ReactNode }) {
  return <div role="status">{title}</div>;
}

export function EmptyState({
  title,
  description,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <div role="status">
      <strong>{title}</strong>
      {description}
    </div>
  );
}

export function ErrorState({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div role="alert">
      <strong>{title}</strong>
      {description}
      {action}
    </div>
  );
}

export function OfflineState({
  title,
  description,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <div role="status">
      <strong>{title}</strong>
      {description}
    </div>
  );
}

export function DegradedState({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div role="status">
      <strong>{title}</strong>
      {description}
      {action}
    </div>
  );
}

export const ConfirmDialog = { show: async () => 'cancelled' as const };
