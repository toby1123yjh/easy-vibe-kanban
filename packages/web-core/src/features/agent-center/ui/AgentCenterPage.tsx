import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CommandIcon,
  SpinnerIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import {
  AgentProviderReadiness,
  AgentSettingsProvider,
  BaseCodingAgent,
  type AgentGarageEntry,
  type AgentProviderCapability,
  type AgentToolProvider,
} from 'shared/types';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { AgentIcon } from '@/shared/components/AgentIcon';
import { AgentConfigurationSettingsPanel } from '@/shared/dialogs/settings/settings/AgentConfigurationSettingsPanel';
import { AgentToolsSettingsSection } from '@/shared/dialogs/settings/settings/AgentToolsSettingsSection';
import {
  useSettingsHost,
  useSettingsMachineClient,
} from '@/shared/dialogs/settings/settings/SettingsHostContext';
import { useSettingsDirty } from '@/shared/dialogs/settings/settings/SettingsDirtyContext';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { isAgentProviderReady } from '@/shared/lib/agentProviderOptions';
import './agent-center.css';

type AgentCenterTab = 'providers' | 'mcp' | 'skills' | 'commands' | 'profiles';

type SummaryState = 'loading' | 'ready' | 'unavailable' | 'error';

type ProviderDefinition = {
  executor: BaseCodingAgent;
  settingsProvider: AgentSettingsProvider;
  toolProvider: AgentToolProvider;
  label: string;
};

const PROVIDERS: ProviderDefinition[] = [
  {
    executor: BaseCodingAgent.CODEX,
    settingsProvider: AgentSettingsProvider.codex,
    toolProvider: 'codex',
    label: 'Codex',
  },
  {
    executor: BaseCodingAgent.CLAUDE_CODE,
    settingsProvider: AgentSettingsProvider.claude_code,
    toolProvider: 'claude_code',
    label: 'Claude Code',
  },
  {
    executor: BaseCodingAgent.GEMINI,
    settingsProvider: AgentSettingsProvider.gemini,
    toolProvider: 'gemini',
    label: 'Gemini',
  },
  {
    executor: BaseCodingAgent.OH_MY_PI,
    settingsProvider: AgentSettingsProvider.oh_my_pi,
    toolProvider: 'oh_my_pi',
    label: 'Oh My Pi',
  },
];

const TABS: AgentCenterTab[] = [
  'providers',
  'mcp',
  'skills',
  'commands',
  'profiles',
];

function garageEntryFor(
  garage: AgentGarageEntry[] | undefined,
  executor: BaseCodingAgent
) {
  return garage?.find((entry) => entry.executor === executor) ?? null;
}

function readinessFor(entry: AgentGarageEntry | null): AgentProviderReadiness {
  if (entry?.policy) return entry.policy.readiness;
  if (entry?.availability.type === 'NOT_FOUND') {
    return AgentProviderReadiness.MISSING_EXECUTABLE;
  }
  if (entry) return AgentProviderReadiness.INSTALLED;
  return AgentProviderReadiness.UNKNOWN;
}

function capabilityKey(capability: AgentProviderCapability): string {
  return `agentCenter.capability.${capability.toLowerCase()}`;
}

function readinessTone(readiness: AgentProviderReadiness) {
  if (isAgentProviderReady(readiness)) return 'ready';
  if (readiness === AgentProviderReadiness.DEGRADED) return 'warning';
  return 'unavailable';
}

function readinessKey(readiness: AgentProviderReadiness): string {
  return `agentCenter.readiness.${readiness.toLowerCase()}`;
}

export function AgentCenterPage() {
  const { t } = useTranslation('common');
  const {
    availableHosts,
    hostsResolved,
    selectedHost,
    selectedHostId,
    setSelectedHostId,
  } = useSettingsHost();
  const { clearAll: clearDirty, isDirty } = useSettingsDirty();
  const machineClient = useSettingsMachineClient();
  const {
    config,
    loading: configLoading,
    reloadSystem,
    updateAndSaveConfig,
  } = useUserSystem();
  const [activeTab, setActiveTab] = useState<AgentCenterTab>('providers');
  const [selectedExecutor, setSelectedExecutor] = useState<BaseCodingAgent>(
    BaseCodingAgent.CODEX
  );
  const [rescanning, setRescanning] = useState(false);
  const [defaultSaving, setDefaultSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const navigationConfirmationPending = useRef(false);
  const allowNavigationRef = useRef(false);
  const navigationBlocker = useBlocker({
    shouldBlockFn: () => isDirty && !allowNavigationRef.current,
    enableBeforeUnload: false,
    withResolver: true,
  });

  const selectedProvider =
    PROVIDERS.find((provider) => provider.executor === selectedExecutor) ??
    PROVIDERS[0];
  const hostAvailable = Boolean(
    machineClient &&
      selectedHost &&
      (selectedHost.kind === 'local' || selectedHost.status !== 'offline')
  );
  const queryPrefix = machineClient?.queryScopeKey ?? ['machine', 'unselected'];

  const garageQuery = useQuery({
    queryKey: [...queryPrefix, 'agent-center', 'garage'],
    queryFn: () => machineClient!.getAgentGarage(),
    enabled: hostAvailable,
    staleTime: 60_000,
  });
  const toolsQuery = useQuery({
    queryKey: [...queryPrefix, 'agent-center', 'tools'],
    queryFn: () => machineClient!.listAgentTools(),
    enabled: hostAvailable,
    staleTime: 30_000,
  });
  const settingsQuery = useQuery({
    queryKey: [
      ...queryPrefix,
      'agent-center',
      'settings-summary',
      selectedProvider.settingsProvider,
    ],
    queryFn: () =>
      machineClient!.discoverAgentSettings({
        provider: selectedProvider.settingsProvider,
      }),
    enabled: hostAvailable,
    staleTime: 30_000,
  });

  const selectedGarageEntry = garageEntryFor(
    garageQuery.data,
    selectedExecutor
  );
  const selectedSnapshot = settingsQuery.data?.providers.find(
    (provider) => provider.provider === selectedProvider.settingsProvider
  );
  const defaultModel = useMemo(() => {
    const setting = selectedSnapshot?.effective_settings.find(
      (candidate) =>
        candidate.key.namespace === 'common' && candidate.key.name === 'model'
    );
    return typeof setting?.effective_value === 'string'
      ? setting.effective_value
      : null;
  }, [selectedSnapshot]);
  const defaultModelSource = useMemo(() => {
    const setting = selectedSnapshot?.effective_settings.find(
      (candidate) =>
        candidate.key.namespace === 'common' && candidate.key.name === 'model'
    );
    return setting?.effective_source ?? null;
  }, [selectedSnapshot]);
  const selectedToolInventory = toolsQuery.data?.providers.find(
    (provider) => provider.provider === selectedProvider.toolProvider
  );
  const toolPayloadErrors = [
    ...(toolsQuery.data?.errors
      .filter((error) => error.provider === selectedProvider.toolProvider)
      .map((error) => error.message) ?? []),
    ...(selectedToolInventory?.errors ?? []),
  ];
  const settingsPayloadErrors = [
    ...(settingsQuery.data?.errors
      .filter((error) => error.provider === selectedProvider.settingsProvider)
      .map((error) => error.message) ?? []),
    ...(selectedSnapshot?.errors.map((error) => error.message) ?? []),
  ];
  const toolsState: SummaryState = toolsQuery.isLoading
    ? 'loading'
    : toolsQuery.isError || toolPayloadErrors.length > 0
      ? 'error'
      : selectedToolInventory?.installed
        ? 'ready'
        : 'unavailable';
  const settingsState: SummaryState = settingsQuery.isLoading
    ? 'loading'
    : settingsQuery.isError || settingsPayloadErrors.length > 0
      ? 'error'
      : selectedSnapshot?.installed
        ? 'ready'
        : 'unavailable';
  const summaryDiagnostics = Array.from(
    new Set([...toolPayloadErrors, ...settingsPayloadErrors])
  );
  const mcpItems =
    selectedToolInventory?.items.filter((item) => item.kind === 'mcp_server') ??
    [];
  const skillItems =
    selectedToolInventory?.items.filter((item) => item.kind === 'skill') ?? [];
  const isDefault =
    config?.executor_profile?.executor === selectedProvider.executor;

  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    if (navigationConfirmationPending.current) return false;
    navigationConfirmationPending.current = true;
    try {
      const result = await ConfirmDialog.show({
        title: t('agentCenter.unsaved.title'),
        message: t('agentCenter.unsaved.message'),
        confirmText: t('agentCenter.unsaved.discard'),
        cancelText: t('agentCenter.unsaved.cancel'),
        variant: 'destructive',
      });
      return result === 'confirmed';
    } finally {
      navigationConfirmationPending.current = false;
    }
  }, [t]);

  const runAfterDirtyConfirmation = useCallback(
    async (action: () => void) => {
      if (!isDirty) {
        action();
        return;
      }
      if (await confirmDiscard()) {
        clearDirty();
        action();
      }
    },
    [clearDirty, confirmDiscard, isDirty]
  );

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (
      navigationBlocker.status !== 'blocked' ||
      navigationConfirmationPending.current
    ) {
      return;
    }
    let cancelled = false;
    void confirmDiscard().then((discard) => {
      if (cancelled || navigationBlocker.status !== 'blocked') return;
      if (discard) {
        allowNavigationRef.current = true;
        clearDirty();
        navigationBlocker.proceed();
      } else {
        navigationBlocker.reset();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clearDirty, confirmDiscard, navigationBlocker]);

  const refreshToolSummary = async () => {
    const result = await toolsQuery.refetch();
    if (result.isError) {
      throw result.error ?? new Error(t('agentCenter.errors.loadTools'));
    }
  };

  const rescan = async () => {
    setRescanning(true);
    setActionError(null);
    try {
      const [garageResult, toolsResult, settingsResult] = await Promise.all([
        garageQuery.refetch(),
        toolsQuery.refetch(),
        settingsQuery.refetch(),
        reloadSystem(),
      ]);
      if (
        garageResult.isError ||
        toolsResult.isError ||
        settingsResult.isError ||
        Boolean(toolsResult.data?.errors.length) ||
        Boolean(
          toolsResult.data?.providers.some(
            (providerInventory) => providerInventory.errors.length > 0
          )
        ) ||
        Boolean(settingsResult.data?.errors.length) ||
        Boolean(
          settingsResult.data?.providers.some(
            (snapshot) => snapshot.errors.length > 0
          )
        )
      ) {
        throw new Error(t('agentCenter.errors.rescan'));
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : t('agentCenter.errors.rescan')
      );
    } finally {
      setRescanning(false);
    }
  };

  const setDefaultProvider = async () => {
    setDefaultSaving(true);
    setActionError(null);
    try {
      const saved = await updateAndSaveConfig({
        executor_profile: {
          executor: selectedProvider.executor,
          variant: null,
        },
      });
      if (!saved) throw new Error(t('agentCenter.errors.setDefault'));
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : t('agentCenter.errors.setDefault')
      );
    } finally {
      setDefaultSaving(false);
    }
  };

  if (!hostsResolved) {
    return (
      <div className="vk-agent-center-state" role="status">
        <SpinnerIcon className="vk-agent-center-spin" aria-hidden="true" />
        {t('agentCenter.states.loadingHosts')}
      </div>
    );
  }

  if (!selectedHost) {
    return (
      <div className="vk-agent-center-state" role="status">
        <WarningCircleIcon aria-hidden="true" />
        <div>
          <h1>{t('agentCenter.title')}</h1>
          <p>{t('agentCenter.states.noHost')}</p>
        </div>
      </div>
    );
  }

  const hostOffline =
    selectedHost.kind === 'remote' && selectedHost.status === 'offline';

  return (
    <section className="vk-agent-center" aria-labelledby="agent-center-title">
      <header className="vk-agent-center__header">
        <div>
          <p className="vk-agent-center__eyebrow">{t('agentCenter.eyebrow')}</p>
          <h1 id="agent-center-title">{t('agentCenter.title')}</h1>
          <p>{t('agentCenter.description')}</p>
        </div>
        <div className="vk-agent-center__header-actions">
          {availableHosts.length > 1 && (
            <label className="vk-agent-center__host-picker">
              <span>{t('agentCenter.host')}</span>
              <select
                value={selectedHostId ?? ''}
                onChange={(event) => {
                  const hostId = event.target.value;
                  if (hostId === selectedHostId) return;
                  void runAfterDirtyConfirmation(() =>
                    setSelectedHostId(hostId)
                  );
                }}
              >
                {availableHosts.map((host) => (
                  <option key={host.id} value={host.id}>
                    {host.label}
                    {host.status === 'offline'
                      ? ` · ${t('agentCenter.states.offline')}`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className="vk-agent-center__rescan"
            disabled={!hostAvailable || rescanning}
            title={
              hostAvailable
                ? undefined
                : t('agentCenter.disabled.hostUnavailable')
            }
            onClick={() => void rescan()}
          >
            {rescanning ? (
              <SpinnerIcon
                className="vk-agent-center-spin"
                aria-hidden="true"
              />
            ) : (
              <ArrowClockwiseIcon aria-hidden="true" />
            )}
            {rescanning ? t('agentCenter.rescanning') : t('agentCenter.rescan')}
          </button>
        </div>
      </header>

      <nav
        className="vk-agent-center__tabs"
        aria-label={t('agentCenter.tabsLabel')}
      >
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            aria-current={activeTab === tab ? 'page' : undefined}
            onClick={() => {
              if (activeTab === tab) return;
              void runAfterDirtyConfirmation(() => setActiveTab(tab));
            }}
          >
            {t(`agentCenter.tabs.${tab}`)}
          </button>
        ))}
      </nav>

      {hostOffline ? (
        <div className="vk-agent-center-state" role="alert">
          <WarningCircleIcon aria-hidden="true" />
          <div>
            <h2>{t('agentCenter.states.hostOfflineTitle')}</h2>
            <p>{t('agentCenter.states.hostOffline')}</p>
          </div>
        </div>
      ) : (
        <div className="vk-agent-center__workspace">
          <aside
            className="vk-agent-center__providers"
            aria-label={t('agentCenter.providerListLabel')}
          >
            <p>{t('agentCenter.providerListTitle')}</p>
            <div>
              {PROVIDERS.map((provider) => {
                const entry = garageEntryFor(
                  garageQuery.data,
                  provider.executor
                );
                const readiness = readinessFor(entry);
                return (
                  <button
                    key={provider.executor}
                    type="button"
                    data-active={provider.executor === selectedExecutor}
                    aria-pressed={provider.executor === selectedExecutor}
                    onClick={() => {
                      if (provider.executor === selectedExecutor) return;
                      void runAfterDirtyConfirmation(() =>
                        setSelectedExecutor(provider.executor)
                      );
                    }}
                  >
                    <AgentIcon agent={provider.executor} />
                    <span>{provider.label}</span>
                    <small data-tone={readinessTone(readiness)}>
                      {t(readinessKey(readiness))}
                    </small>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="vk-agent-center__content">
            {actionError && (
              <div className="vk-agent-center__alert" role="alert">
                <WarningCircleIcon aria-hidden="true" />
                {actionError}
              </div>
            )}
            {garageQuery.isError && activeTab === 'providers' && (
              <div className="vk-agent-center__alert" role="alert">
                <WarningCircleIcon aria-hidden="true" />
                {t('agentCenter.errors.loadProviders')}
              </div>
            )}

            {activeTab === 'providers' && (
              <ProviderOverview
                provider={selectedProvider}
                entry={selectedGarageEntry}
                model={defaultModel}
                modelSource={defaultModelSource}
                mcpEnabled={
                  mcpItems.filter((item) => item.state === 'enabled').length
                }
                mcpTotal={mcpItems.length}
                skillsEnabled={
                  skillItems.filter((item) => item.state === 'enabled').length
                }
                skillsTotal={skillItems.length}
                toolsState={toolsState}
                settingsState={settingsState}
                summaryDiagnostics={summaryDiagnostics}
                defaultState={
                  configLoading ? 'loading' : config ? 'ready' : 'unavailable'
                }
                isDefault={isDefault}
                loading={garageQuery.isLoading}
                defaultSaving={defaultSaving}
                onSetDefault={() => void setDefaultProvider()}
                onOpenConfiguration={() =>
                  void runAfterDirtyConfirmation(() => setActiveTab('profiles'))
                }
                onOpenTools={() =>
                  void runAfterDirtyConfirmation(() => setActiveTab('mcp'))
                }
              />
            )}
            {activeTab === 'mcp' && (
              <AgentToolsSettingsSection
                provider={selectedProvider.toolProvider}
                fixedKind="mcp_server"
                onInventoryChange={refreshToolSummary}
              />
            )}
            {activeTab === 'skills' && (
              <AgentToolsSettingsSection
                provider={selectedProvider.toolProvider}
                fixedKind="skill"
                onInventoryChange={refreshToolSummary}
              />
            )}
            {activeTab === 'commands' && (
              <CommandsPanel
                provider={selectedProvider}
                entry={selectedGarageEntry}
              />
            )}
            {activeTab === 'profiles' && (
              <AgentConfigurationSettingsPanel
                executor={selectedProvider.executor}
                variant={null}
                includeTools={false}
              />
            )}
          </section>
        </div>
      )}
    </section>
  );
}

function ProviderOverview({
  provider,
  entry,
  model,
  modelSource,
  mcpEnabled,
  mcpTotal,
  skillsEnabled,
  skillsTotal,
  toolsState,
  settingsState,
  summaryDiagnostics,
  defaultState,
  isDefault,
  loading,
  defaultSaving,
  onSetDefault,
  onOpenConfiguration,
  onOpenTools,
}: {
  provider: ProviderDefinition;
  entry: AgentGarageEntry | null;
  model: string | null;
  modelSource: string | null;
  mcpEnabled: number;
  mcpTotal: number;
  skillsEnabled: number;
  skillsTotal: number;
  toolsState: SummaryState;
  settingsState: SummaryState;
  summaryDiagnostics: string[];
  defaultState: SummaryState;
  isDefault: boolean;
  loading: boolean;
  defaultSaving: boolean;
  onSetDefault: () => void;
  onOpenConfiguration: () => void;
  onOpenTools: () => void;
}) {
  const { t } = useTranslation('common');
  const readiness = readinessFor(entry);
  const capabilities = entry?.policy?.capabilities ?? [];
  const diagnostics = entry?.policy?.diagnostics ?? [];
  const configurationSource =
    modelSource === 'native_project'
      ? t('agentCenter.configurationSources.nativeProject')
      : modelSource === 'native_user'
        ? t('agentCenter.configurationSources.nativeUser')
        : t('agentCenter.adapterManaged');
  const providerReady = isAgentProviderReady(readiness);
  const defaultUnavailableReason =
    defaultState === 'loading'
      ? t('agentCenter.disabled.configLoading')
      : defaultState === 'unavailable'
        ? t('agentCenter.disabled.configUnavailable')
        : !providerReady
          ? t('agentCenter.disabled.providerUnavailable')
          : undefined;

  const summaryValue = (
    state: SummaryState,
    readyValue: string,
    unavailableValue = t('agentCenter.states.summaryUnavailable')
  ) => {
    switch (state) {
      case 'loading':
        return t('agentCenter.states.summaryLoading');
      case 'error':
        return t('agentCenter.states.summaryError');
      case 'unavailable':
        return unavailableValue;
      case 'ready':
        return readyValue;
    }
  };

  return (
    <div className="vk-agent-center__overview">
      <div className="vk-agent-center__provider-heading">
        <div>
          <p>{t('agentCenter.selectedProvider')}</p>
          <h2>{provider.label}</h2>
          <span data-tone={readinessTone(readiness)}>
            {t(readinessKey(readiness))}
            {' · '}
            {entry?.bundled_version
              ? t('agentCenter.bundledVersion', {
                  version: entry.bundled_version,
                })
              : t('agentCenter.versionUnavailable')}
          </span>
        </div>
        <div className="vk-agent-center__provider-actions">
          <button
            type="button"
            disabled={
              isDefault ||
              !providerReady ||
              defaultSaving ||
              defaultState !== 'ready'
            }
            title={defaultUnavailableReason}
            aria-label={
              defaultUnavailableReason
                ? `${t('agentCenter.setDefault')}: ${defaultUnavailableReason}`
                : undefined
            }
            onClick={onSetDefault}
          >
            {defaultSaving && (
              <SpinnerIcon
                className="vk-agent-center-spin"
                aria-hidden="true"
              />
            )}
            {isDefault
              ? t('agentCenter.defaultProvider')
              : t('agentCenter.setDefault')}
          </button>
          <button type="button" onClick={onOpenConfiguration}>
            {t('agentCenter.openConfiguration')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="vk-agent-center__loading" role="status">
          <SpinnerIcon className="vk-agent-center-spin" aria-hidden="true" />
          {t('agentCenter.states.loadingProvider')}
        </div>
      ) : (
        <>
          {diagnostics.length > 0 && (
            <div className="vk-agent-center__diagnostics">
              {diagnostics.map((diagnostic) => (
                <p key={`${diagnostic.kind}:${diagnostic.message}`}>
                  <WarningCircleIcon aria-hidden="true" />
                  {diagnostic.message}
                </p>
              ))}
            </div>
          )}

          {summaryDiagnostics.length > 0 && (
            <div
              className="vk-agent-center__diagnostics"
              role="alert"
              aria-label={t('agentCenter.states.summaryDiagnostics')}
            >
              {summaryDiagnostics.map((diagnostic) => (
                <p key={diagnostic}>
                  <WarningCircleIcon aria-hidden="true" />
                  {diagnostic}
                </p>
              ))}
            </div>
          )}

          <section className="vk-agent-center__section">
            <h3>{t('agentCenter.capabilities')}</h3>
            {capabilities.length > 0 ? (
              <div className="vk-agent-center__capabilities">
                {capabilities.map((capability) => (
                  <span key={capability}>
                    <CheckCircleIcon aria-hidden="true" />
                    {t(capabilityKey(capability))}
                  </span>
                ))}
              </div>
            ) : (
              <p className="vk-agent-center__empty">
                {t('agentCenter.noCapabilities')}
              </p>
            )}
          </section>

          <section className="vk-agent-center__section">
            <div className="vk-agent-center__section-heading">
              <h3>{t('agentCenter.enabledTools')}</h3>
              <button type="button" onClick={onOpenTools}>
                {t('agentCenter.manageTools')}
              </button>
            </div>
            <div className="vk-agent-center__metric-grid">
              <Metric
                label={t('agentCenter.tabs.mcp')}
                value={summaryValue(toolsState, `${mcpEnabled} / ${mcpTotal}`)}
                state={toolsState}
              />
              <Metric
                label={t('agentCenter.tabs.skills')}
                value={summaryValue(
                  toolsState,
                  `${skillsEnabled} / ${skillsTotal}`
                )}
                state={toolsState}
              />
              <Metric
                label={t('agentCenter.tabs.commands')}
                value={t('agentCenter.commands.notManaged')}
                state="unavailable"
              />
            </div>
          </section>

          <section className="vk-agent-center__section">
            <div className="vk-agent-center__section-heading">
              <h3>{t('agentCenter.nativeSummary')}</h3>
              <button type="button" onClick={onOpenConfiguration}>
                {t('buttons.edit')}
              </button>
            </div>
            <div className="vk-agent-center__metric-grid">
              <Metric
                label={t('agentCenter.defaultModel')}
                value={summaryValue(
                  settingsState,
                  model ?? t('agentCenter.inheritedOrUnset')
                )}
                state={settingsState}
              />
              <Metric
                label={t('agentCenter.apiAddress')}
                value={t('agentCenter.apiAddressUnavailable')}
                state="unavailable"
              />
              <Metric
                label={t('agentCenter.configurationSource')}
                value={summaryValue(settingsState, configurationSource)}
                state={settingsState}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  state = 'ready',
}: {
  label: string;
  value: string;
  state?: SummaryState;
}) {
  return (
    <div className="vk-agent-center__metric" data-state={state}>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function CommandsPanel({
  provider,
  entry,
}: {
  provider: ProviderDefinition;
  entry: AgentGarageEntry | null;
}) {
  const { t } = useTranslation('common');
  const readiness = readinessFor(entry);
  const providerReady = isAgentProviderReady(readiness);
  const diagnostic = entry?.policy?.diagnostics[0]?.message;
  return (
    <section className="vk-agent-center__commands">
      <CommandIcon aria-hidden="true" />
      <p>{t('agentCenter.tabs.commands')}</p>
      <h2>{t('agentCenter.commands.title')}</h2>
      <span>{t('agentCenter.commands.description')}</span>
      <div role={providerReady ? 'status' : 'alert'}>
        {providerReady
          ? t('agentCenter.commands.noManagementAdapter', {
              provider: provider.label,
            })
          : t('agentCenter.commands.providerUnavailable', {
              provider: provider.label,
              status: t(readinessKey(readiness)),
              reason: diagnostic ?? t('agentCenter.commands.noDiagnostic'),
            })}
      </div>
    </section>
  );
}
