import {
  AgentSettingsProvider,
  BaseCodingAgent,
  type AgentCommandProvider,
  type AgentToolProvider,
} from 'shared/types';

export interface AgentProviderDefinition {
  executor: BaseCodingAgent;
  settingsProvider: AgentSettingsProvider;
  toolProvider: AgentToolProvider;
  commandProvider: AgentCommandProvider;
  label: string;
  npmPackage?: string;
  developerPreview?: boolean;
}

// Keep provider-native IDs explicit: the four API namespaces do not share a
// casing convention. This record also makes new executors a compile-time check.
export const AGENT_PROVIDER_BY_EXECUTOR: Record<
  BaseCodingAgent,
  AgentProviderDefinition
> = {
  [BaseCodingAgent.CODEX]: {
    executor: BaseCodingAgent.CODEX,
    settingsProvider: AgentSettingsProvider.codex,
    toolProvider: 'codex',
    commandProvider: 'codex',
    label: 'Codex',
    npmPackage: '@openai/codex',
  },
  [BaseCodingAgent.CLAUDE_CODE]: {
    executor: BaseCodingAgent.CLAUDE_CODE,
    settingsProvider: AgentSettingsProvider.claude_code,
    toolProvider: 'claude_code',
    commandProvider: 'claude_code',
    label: 'Claude Code',
  },
  [BaseCodingAgent.GEMINI]: {
    executor: BaseCodingAgent.GEMINI,
    settingsProvider: AgentSettingsProvider.gemini,
    toolProvider: 'gemini',
    commandProvider: 'gemini',
    label: 'Gemini',
    npmPackage: '@google/gemini-cli',
  },
  [BaseCodingAgent.OH_MY_PI]: {
    executor: BaseCodingAgent.OH_MY_PI,
    settingsProvider: AgentSettingsProvider.oh_my_pi,
    toolProvider: 'oh_my_pi',
    commandProvider: 'oh_my_pi',
    label: 'Oh My Pi',
  },
  [BaseCodingAgent.OPENCODE]: {
    executor: BaseCodingAgent.OPENCODE,
    settingsProvider: AgentSettingsProvider.opencode,
    toolProvider: 'opencode',
    commandProvider: 'opencode',
    label: 'OpenCode',
    npmPackage: 'opencode-ai',
  },
  [BaseCodingAgent.DEEPSEEK_HARNESS]: {
    executor: BaseCodingAgent.DEEPSEEK_HARNESS,
    settingsProvider: AgentSettingsProvider.deepseek_harness,
    toolProvider: 'deepseek_harness',
    commandProvider: 'deepseek_harness',
    label: 'DeepSeek Harness',
    npmPackage: '@deepseek-ai/dsh',
    developerPreview: true,
  },
};

export const AGENT_PROVIDERS: readonly AgentProviderDefinition[] =
  Object.values(AGENT_PROVIDER_BY_EXECUTOR);

export function agentProviderForSettings(
  provider: AgentSettingsProvider
): AgentProviderDefinition {
  const definition = AGENT_PROVIDERS.find(
    (candidate) => candidate.settingsProvider === provider
  );
  if (!definition) throw new Error('Unknown agent settings provider');
  return definition;
}

export function agentExecutorFromSearch(
  value: unknown
): BaseCodingAgent | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return AGENT_PROVIDERS.find(
    (provider) =>
      provider.executor.toLowerCase() === normalized ||
      provider.settingsProvider === normalized ||
      provider.label.toLowerCase() === normalized
  )?.executor;
}
