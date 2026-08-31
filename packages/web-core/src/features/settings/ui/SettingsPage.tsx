import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  CloudIcon,
  DesktopIcon,
  GearIcon,
  InfoIcon,
  SpinnerIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { PrimaryButton } from '@vibe/ui/components/PrimaryButton';
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
import { SettingsMachineUserSystemProvider } from '@/shared/dialogs/settings/settings/SettingsMachineUserSystemProvider';
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
  const {
    availableHosts,
    hostsResolved,
    selectedHost,
    selectedHostId,
    setSelectedHostId,
  } = useSettingsHost();
  const machineClient = useSettingsMachineClient();
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

  if (!hostsResolved) {
    return (
      <div className="vk-settings-state" role="status">
        <SpinnerIcon className="vk-settings-spin" aria-hidden="true" />
        {t('settings.page.states.loadingHosts', 'Loading available hosts…')}
      </div>
    );
  }

  const hostUnavailable =
    !machineClient ||
    !selectedHost ||
    (selectedHost.kind === 'remote' && selectedHost.status === 'offline');
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
        {requiresHost && hostUnavailable ? (
          <HostUnavailableState selectedHost={selectedHost} />
        ) : (
          <SettingsContent
            key={`${selectedHostId ?? 'unselected'}:${route.section}`}
            section={route.section}
            hostId={route.host}
          />
        )}
      </div>
    </section>
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
        <div>
          <span>{t('settings.page.version.update', 'Downloaded update')}</span>
          <p>
            {canInstallUpdate
              ? t(
                  'settings.page.version.ready',
                  'Version {{version}} is ready to install.',
                  { version: updateVersion }
                )
              : t(
                  'settings.page.version.notReady',
                  'No downloaded update is ready. Update checks and channels are unavailable here.'
                )}
          </p>
        </div>
        {canInstallUpdate && (
          <PrimaryButton onClick={() => restart?.()}>
            {t('settings.page.version.restart', 'Restart and install')}
          </PrimaryButton>
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

function HostUnavailableState({
  selectedHost,
}: {
  selectedHost: ReturnType<typeof useSettingsHost>['selectedHost'];
}) {
  const { t } = useTranslation('settings');
  return (
    <div className="vk-settings-state" role="alert">
      <WarningCircleIcon aria-hidden="true" />
      <div>
        <h2>
          {selectedHost
            ? t('settings.page.states.hostOfflineTitle', 'Host unavailable')
            : t('settings.page.states.noHostTitle', 'No host selected')}
        </h2>
        <p>
          {selectedHost
            ? t(
                'settings.page.states.hostOffline',
                'Reconnect this host before viewing or changing its settings.'
              )
            : t(
                'settings.page.states.noHost',
                'Select an available host to manage host-owned settings.'
              )}
        </p>
      </div>
    </div>
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
