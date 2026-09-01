import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  CloudIcon,
  DesktopIcon,
  GearIcon,
  InfoIcon,
} from '@phosphor-icons/react';
import { Button } from '@vibe/ui/components/Button';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { PrimaryButton } from '@vibe/ui/components/PrimaryButton';
import {
  DegradedState,
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
} from '@vibe/ui/components/StateSurface';
import { GeneralSettingsSection } from '@/shared/dialogs/settings/settings/GeneralSettingsSection';
import { OrganizationsSettingsSection } from '@/shared/dialogs/settings/settings/OrganizationsSettingsSection';
import { RelaySettingsSectionContent } from '@/shared/dialogs/settings/settings/RelaySettingsSection';
import { RemoteProjectsSettingsSection } from '@/shared/dialogs/settings/settings/RemoteProjectsSettingsSection';
import { ReposSettingsSection } from '@/shared/dialogs/settings/settings/ReposSettingsSection';
import { SettingsCard } from '@/shared/dialogs/settings/settings/SettingsComponents';
import {
  SettingsHostProvider,
  useSettingsHost,
  useSettingsMachineClient,
} from '@/shared/dialogs/settings/settings/SettingsHostContext';
import { useSettingsDirty } from '@/shared/dialogs/settings/settings/SettingsDirtyContext';
import {
  SettingsMachineUserSystemProvider,
  useSettingsMachineState,
} from '@/shared/dialogs/settings/settings/SettingsMachineUserSystemProvider';
import { useAppRuntime } from '@/shared/hooks/useAppRuntime';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import { useAppUpdateStore } from '@/shared/stores/useAppUpdateStore';
import {
  isCanonicalSettingsSearch,
  resolveSettingsRoute,
  SETTINGS_SECTIONS,
  SETTINGS_TABS,
  type ResolvedSettingsRoute,
  type SettingsSearchParams,
  type SettingsSection,
} from '../model/settingsRoute';
import './settings-page.css';

interface SettingsPageProps {
  search: SettingsSearchParams;
  onSearchChange(
    search: ResolvedSettingsRoute,
    options?: { replace?: boolean }
  ): void;
}

const TAB_ICONS = {
  general: GearIcon,
  host: DesktopIcon,
  cloud: CloudIcon,
} as const;

const TAB_LABELS = {
  general: 'General',
  host: 'Current Host',
  cloud: 'Cloud',
} as const;

const SECTION_LABELS = {
  application: 'Application',
  repositories: 'Repositories',
  relay: 'Remote Access',
  organizations: 'Organizations',
  projects: 'Projects',
} as const;

export function SettingsPage({ search, onSearchChange }: SettingsPageProps) {
  const { t } = useTranslation('settings');
  const { availableHosts, selectedHostId, setSelectedHostId } =
    useSettingsHost();
  const { clearAll: clearDirty, isDirty } = useSettingsDirty();
  const route = useMemo(() => resolveSettingsRoute(search), [search]);
  const confirmationPendingRef = useRef(false);
  const allowNavigationRef = useRef(false);
  const navigationBlocker = useBlocker({
    shouldBlockFn: () => isDirty && !allowNavigationRef.current,
    enableBeforeUnload: false,
    withResolver: true,
  });

  useEffect(() => {
    if (!isCanonicalSettingsSearch(search, route)) {
      onSearchChange(route, { replace: true });
    }
  }, [onSearchChange, route, search]);

  const confirmDiscard = useCallback(async () => {
    if (confirmationPendingRef.current) return false;
    confirmationPendingRef.current = true;
    try {
      const result = await ConfirmDialog.show({
        title: t('settings.page.unsaved.title', 'Unsaved settings'),
        message: t(
          'settings.page.unsaved.message',
          'Discard your unsaved changes before leaving this section?'
        ),
        confirmText: t('settings.page.unsaved.discard', 'Discard changes'),
        cancelText: t('settings.page.unsaved.cancel', 'Keep editing'),
        variant: 'destructive',
      });
      return result === 'confirmed';
    } finally {
      confirmationPendingRef.current = false;
    }
  }, [t]);

  const runAfterDirtyConfirmation = useCallback(
    async (action: () => void, navigation = false) => {
      if (!isDirty) {
        action();
        return;
      }
      if (await confirmDiscard()) {
        if (navigation) allowNavigationRef.current = true;
        clearDirty();
        try {
          action();
        } finally {
          if (navigation) {
            queueMicrotask(() => {
              allowNavigationRef.current = false;
            });
          }
        }
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
      confirmationPendingRef.current
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
        queueMicrotask(() => {
          allowNavigationRef.current = false;
        });
      } else {
        navigationBlocker.reset();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [clearDirty, confirmDiscard, navigationBlocker]);

  const navigateTo = (next: ResolvedSettingsRoute) => {
    if (next.tab === route.tab && next.section === route.section) return;
    void runAfterDirtyConfirmation(
      () =>
        onSearchChange({
          ...next,
          ...(route.host ? { host: route.host } : {}),
        }),
      true
    );
  };

  const requiresHost = route.tab !== 'cloud';

  return (
    <section className="vk-settings-page" aria-labelledby="settings-title">
      <header className="vk-settings-page__header">
        <div>
          <p className="vk-settings-page__eyebrow">
            {t('settings.page.eyebrow', 'Application and environment')}
          </p>
          <h1 id="settings-title">{t('settings.page.title', 'Settings')}</h1>
          <p>
            {t(
              'settings.page.description',
              'Manage application preferences, the selected host and cloud resources.'
            )}
          </p>
        </div>
        {route.tab !== 'cloud' && availableHosts.length > 0 && (
          <label className="vk-settings-page__host-picker">
            <span>{t('settings.page.currentHost', 'Current host')}</span>
            <select
              value={selectedHostId ?? ''}
              onChange={(event) => {
                const hostId = event.target.value;
                if (hostId === selectedHostId) return;
                void runAfterDirtyConfirmation(() => {
                  setSelectedHostId(hostId);
                  onSearchChange({ ...route, host: hostId });
                }, true);
              }}
            >
              {availableHosts.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.label}
                  {host.status === 'offline'
                    ? ` · ${t('settings.page.states.offline', 'Offline')}`
                    : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>

      <nav
        className="vk-settings-page__tabs"
        aria-label={t('settings.page.tabsLabel', 'Settings categories')}
      >
        {SETTINGS_TABS.map((tab) => {
          const Icon = TAB_ICONS[tab];
          return (
            <button
              key={tab}
              type="button"
              aria-current={route.tab === tab ? 'page' : undefined}
              onClick={() =>
                navigateTo({ tab, section: SETTINGS_SECTIONS[tab][0] })
              }
            >
              <Icon aria-hidden="true" />
              {t(`settings.page.tabs.${tab}`, TAB_LABELS[tab])}
            </button>
          );
        })}
      </nav>

      <nav
        className="vk-settings-page__sections"
        aria-label={t('settings.page.sectionsLabel', 'Settings sections')}
      >
        {SETTINGS_SECTIONS[route.tab].map((section) => (
          <button
            key={section}
            type="button"
            aria-current={route.section === section ? 'page' : undefined}
            onClick={() => navigateTo({ tab: route.tab, section })}
          >
            {t(`settings.page.sections.${section}`, SECTION_LABELS[section])}
          </button>
        ))}
      </nav>

      <div className="vk-settings-page__content">
        <SettingsContentBoundary
          key={`${selectedHostId ?? 'unselected'}:${route.section}`}
          requiresHost={requiresHost}
          section={route.section}
          routeHostId={route.host}
        />
      </div>
    </section>
  );
}

function SettingsContentBoundary({
  requiresHost,
  section,
  routeHostId,
}: {
  requiresHost: boolean;
  section: SettingsSection;
  routeHostId?: string;
}) {
  const { t } = useTranslation('settings');
  const { hostDiscovery, selectedHost, selectedHostId } = useSettingsHost();
  const machineClient = useSettingsMachineClient();
  const machineState = useSettingsMachineState();

  if (!requiresHost) {
    return <SettingsContent section={section} hostId={routeHostId} />;
  }

  if (hostDiscovery.isLoading && !hostDiscovery.hasCanonicalData) {
    return (
      <LoadingState
        className="vk-settings-state"
        title={t(
          'settings.page.states.loadingHosts',
          'Loading available hosts…'
        )}
      />
    );
  }

  if (hostDiscovery.error && !hostDiscovery.hasCanonicalData) {
    return (
      <ErrorState
        className="vk-settings-state"
        title={t(
          'settings.page.states.hostDiscoveryErrorTitle',
          'Hosts could not be loaded'
        )}
        description={t(
          'settings.page.states.hostDiscoveryError',
          'Try loading the available hosts again.'
        )}
        action={
          hostDiscovery.canRetry ? (
            <RetryButton
              label={t('settings.page.states.retryHosts', 'Retry')}
              loadingLabel={t(
                'settings.page.states.retryingHosts',
                'Retrying host discovery'
              )}
              isRetrying={hostDiscovery.isRetrying}
              onRetry={hostDiscovery.retry}
            />
          ) : undefined
        }
      />
    );
  }

  if (!selectedHost || !machineClient) {
    const retryAction = hostDiscovery.canRetry ? (
      <RetryButton
        label={t('settings.page.states.checkHosts', 'Check again')}
        loadingLabel={t(
          'settings.page.states.checkingHosts',
          'Checking available hosts'
        )}
        isRetrying={hostDiscovery.isRetrying}
        onRetry={hostDiscovery.retry}
      />
    ) : undefined;

    if (selectedHostId != null) {
      return (
        <ErrorState
          className="vk-settings-state"
          title={t(
            'settings.page.states.selectedHostUnavailableTitle',
            'Selected host unavailable'
          )}
          description={t(
            'settings.page.states.selectedHostUnavailable',
            'This host is not currently available to this application. Choose another host or try again.'
          )}
          action={retryAction}
        />
      );
    }

    return (
      <EmptyState
        className="vk-settings-state"
        title={t('settings.page.states.noHostTitle', 'No host available')}
        description={t(
          'settings.page.states.noHost',
          'Connect a host before managing host-owned settings.'
        )}
        action={retryAction}
      />
    );
  }

  if (selectedHost.kind === 'remote' && selectedHost.status === 'offline') {
    return (
      <OfflineState
        className="vk-settings-state"
        title={t('settings.page.states.hostOfflineTitle', 'Host unavailable')}
        description={t(
          'settings.page.states.hostOffline',
          'Reconnect this host before viewing or changing its settings.'
        )}
        action={
          hostDiscovery.canRetry ? (
            <RetryButton
              label={t('settings.page.states.checkHosts', 'Check again')}
              loadingLabel={t(
                'settings.page.states.checkingHosts',
                'Checking available hosts'
              )}
              isRetrying={hostDiscovery.isRetrying}
              onRetry={hostDiscovery.retry}
            />
          ) : undefined
        }
      />
    );
  }

  if (machineState.isLoading && !machineState.hasCanonicalData) {
    return (
      <LoadingState
        className="vk-settings-state"
        title={t(
          'settings.page.states.loadingHostSettings',
          'Loading host settings…'
        )}
      />
    );
  }

  if (machineState.error && !machineState.hasCanonicalData) {
    return (
      <ErrorState
        className="vk-settings-state"
        title={t(
          'settings.page.states.hostSettingsErrorTitle',
          'Host settings could not be loaded'
        )}
        description={t(
          'settings.page.states.hostSettingsError',
          'The selected host is available, but its settings request failed.'
        )}
        action={
          <RetryButton
            label={t('settings.page.states.retrySettings', 'Retry')}
            loadingLabel={t(
              'settings.page.states.retryingSettings',
              'Retrying host settings'
            )}
            isRetrying={machineState.isRetrying}
            onRetry={machineState.retry}
          />
        }
      />
    );
  }

  const hostDiscoveryDegraded =
    hostDiscovery.hasCanonicalData && hostDiscovery.error != null;
  const machineSettingsDegraded =
    machineState.hasCanonicalData && machineState.error != null;
  const isDegraded = hostDiscoveryDegraded || machineSettingsDegraded;
  const isRetrying =
    (hostDiscoveryDegraded && hostDiscovery.isRetrying) ||
    (machineSettingsDegraded && machineState.isRetrying);
  const retryDegraded = async () => {
    await Promise.all([
      hostDiscoveryDegraded ? hostDiscovery.retry() : Promise.resolve(),
      machineSettingsDegraded ? machineState.retry() : Promise.resolve(),
    ]);
  };

  return (
    <>
      {isDegraded && (
        <DegradedState
          id="settings-degraded-state"
          compact
          className="vk-settings-page__degraded"
          title={t(
            'settings.page.states.degradedTitle',
            'Settings are temporarily read-only'
          )}
          description={t(
            'settings.page.states.degraded',
            'Previously loaded settings remain visible, but changes are disabled until the refresh succeeds.'
          )}
          action={
            <RetryButton
              label={t('settings.page.states.retryRefresh', 'Retry refresh')}
              loadingLabel={t(
                'settings.page.states.retryingRefresh',
                'Retrying settings refresh'
              )}
              isRetrying={isRetrying}
              onRetry={retryDegraded}
            />
          }
        />
      )}
      <fieldset
        className="vk-settings-page__host-content"
        disabled={isDegraded}
        aria-describedby={isDegraded ? 'settings-degraded-state' : undefined}
      >
        <SettingsContent section={section} hostId={routeHostId} />
      </fieldset>
    </>
  );
}

function RetryButton({
  label,
  loadingLabel,
  isRetrying,
  onRetry,
}: {
  label: string;
  loadingLabel: string;
  isRetrying: boolean;
  onRetry: () => Promise<void>;
}) {
  return (
    <Button
      className="min-h-11"
      type="button"
      loading={isRetrying}
      loadingLabel={loadingLabel}
      onClick={() => void onRetry()}
    >
      {label}
    </Button>
  );
}

function SettingsContent({
  section,
  hostId,
}: {
  section: SettingsSection;
  hostId?: string;
}) {
  switch (section) {
    case 'application':
      return (
        <>
          <GeneralSettingsSection includeAgentSettings={false} />
          <VersionSettings />
          <UnavailableSettings />
        </>
      );
    case 'repositories':
      return <ReposSettingsSection />;
    case 'relay':
      return <RelaySettingsContent hostId={hostId} />;
    case 'organizations':
      return <OrganizationsSettingsSection />;
    case 'projects':
      return <RemoteProjectsSettingsSection />;
  }
}

function VersionSettings() {
  const { t } = useTranslation('settings');
  const runtime = useAppRuntime();
  const { selectedHost } = useSettingsHost();
  const { appVersion } = useUserSystem();
  const updateVersion = useAppUpdateStore((state) => state.updateVersion);
  const restart = useAppUpdateStore((state) => state.restart);
  const canInstallUpdate =
    runtime === 'local' &&
    selectedHost?.kind === 'local' &&
    Boolean(updateVersion && restart);

  return (
    <SettingsCard
      title={t('settings.page.version.title', 'Version and updates')}
      description={t(
        'settings.page.version.description',
        'Review the version reported by this host and any downloaded desktop update.'
      )}
    >
      <div className="vk-settings-page__version-row">
        <div>
          <span>{t('settings.page.version.current', 'Current version')}</span>
          <strong>
            {appVersion || t('settings.page.version.unknown', 'Unavailable')}
          </strong>
        </div>
        {canInstallUpdate && (
          <div>
            <span>
              {t('settings.page.version.update', 'Downloaded update')}
            </span>
            <p>
              {t(
                'settings.page.version.ready',
                'Version {{version}} is ready to install.',
                { version: updateVersion }
              )}
            </p>
            <PrimaryButton onClick={() => restart?.()}>
              {t('settings.page.version.restart', 'Restart and install')}
            </PrimaryButton>
          </div>
        )}
      </div>
    </SettingsCard>
  );
}

function RelaySettingsContent({ hostId }: { hostId?: string }) {
  const runtime = useAppRuntime();

  if (runtime !== 'local') {
    return <RelaySettingsSectionContent initialState={{ hostId }} />;
  }

  // Local Relay APIs always address this process. Isolate the section from
  // any remote host selected on another tab so config and mutations cannot
  // cross host ownership boundaries.
  return (
    <SettingsHostProvider initialHostId="local">
      <SettingsMachineUserSystemProvider>
        <RelaySettingsSectionContent />
      </SettingsMachineUserSystemProvider>
    </SettingsHostProvider>
  );
}

function UnavailableSettings() {
  const { t } = useTranslation('settings');
  const unavailable = [
    ['density', 'Density'],
    ['fontScale', 'Desktop font scale'],
    ['updateChannel', 'Update channel'],
    ['backupRestore', 'Backup and restore'],
    ['diagnostics', 'Diagnostics'],
    ['notifications', 'System notification management'],
    ['dataDirectory', 'Data directory management'],
  ] as const;

  return (
    <SettingsCard
      title={t('settings.page.unavailable.title', 'Planned settings')}
      description={t(
        'settings.page.unavailable.description',
        'These settings are visible for clarity but are not configurable yet.'
      )}
    >
      <div className="vk-settings-page__unavailable-grid">
        {unavailable.map(([key, label]) => (
          <div key={key} className="vk-settings-page__unavailable-item">
            <InfoIcon aria-hidden="true" />
            <span>{t(`settings.page.unavailable.${key}`, label)}</span>
            <small>
              {t('settings.page.unavailable.status', 'Unavailable')}
            </small>
          </div>
        ))}
      </div>
    </SettingsCard>
  );
}
