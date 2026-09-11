import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAppRuntime, type AppRuntime } from '@/shared/hooks/useAppRuntime';
import { useAuth } from '@/shared/hooks/auth/useAuth';
import { useHostId } from '@/shared/providers/HostIdProvider';
import {
  createMachineClient,
  type MachineClient,
  type MachineTarget,
} from '@/shared/lib/machineClient';
import {
  useRemoteCloudHostsState,
  type RemoteCloudHost,
} from '@/shared/hooks/useRemoteCloudHosts';

export type SettingsHostTargetId = 'local' | string;

export type SettingsHostTarget = MachineTarget & {
  description?: string;
  status?: 'online' | 'offline';
};

interface SettingsHostContextValue {
  availableHosts: SettingsHostTarget[];
  hostsResolved: boolean;
  hostDiscovery: {
    hasCanonicalData: boolean;
    isLoading: boolean;
    isRetrying: boolean;
    error: unknown;
    canRetry: boolean;
    retry: () => Promise<void>;
  };
  remoteHostDiscovery: SettingsHostContextValue['hostDiscovery'];
  selectedHostId: SettingsHostTargetId | null;
  selectedHost: SettingsHostTarget | null;
  setSelectedHostId: (hostId: SettingsHostTargetId) => void;
}

const SettingsHostContext = createContext<SettingsHostContextValue | null>(
  null
);

function toLocalRuntimeTargets(
  remoteHosts: RemoteCloudHost[],
  getLabel: (key: string, defaultValue: string) => string
): SettingsHostTarget[] {
  return [
    {
      id: 'local',
      apiHostId: null,
      label: getLabel('settings.hostPicker.thisMachine', 'This machine'),
      description: getLabel('settings.hostPicker.localHost', 'Local host'),
      kind: 'local',
    },
    ...remoteHosts.map((host) => ({
      id: host.id,
      apiHostId: host.id,
      label: host.name,
      description: getLabel('settings.hostPicker.remoteHost', 'Remote host'),
      status:
        host.status === 'online' ? ('online' as const) : ('offline' as const),
      kind: 'remote' as const,
    })),
  ];
}

function getInitialHostId(
  hosts: SettingsHostTarget[],
  runtime: AppRuntime,
  routeHostId: string | null,
  initialHostId?: SettingsHostTargetId
): SettingsHostTargetId | null {
  // An explicit deep-link target must fail closed until that exact Host is
  // available. Falling back here would make a routed settings link edit a
  // different machine than the URL names.
  if (initialHostId) {
    return initialHostId;
  }

  if (routeHostId) {
    return routeHostId;
  }

  if (runtime === 'local') {
    return (
      hosts.find((host) => host.id === 'local')?.id ?? hosts[0]?.id ?? null
    );
  }

  return (
    hosts.find((host) => host.status === 'online')?.id ?? hosts[0]?.id ?? null
  );
}

export function SettingsHostProvider({
  initialHostId,
  children,
}: {
  initialHostId?: SettingsHostTargetId;
  children: ReactNode;
}) {
  const { t } = useTranslation('settings');
  const runtime = useAppRuntime();
  const routeHostId = useHostId();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const discoveryEnabled = authLoaded && isSignedIn;
  const remoteCloudHostsState = useRemoteCloudHostsState({
    enabled: discoveryEnabled,
  });
  const hostDiscoveryHasCanonicalData =
    (authLoaded && !isSignedIn) || remoteCloudHostsState.hasCanonicalData;
  const hostDiscoveryLoading =
    !authLoaded || (isSignedIn && remoteCloudHostsState.isLoading);

  const remoteHostDiscovery = useMemo(
    () => ({
      hasCanonicalData: hostDiscoveryHasCanonicalData,
      isLoading: hostDiscoveryLoading,
      isRetrying: remoteCloudHostsState.isRetrying,
      error: discoveryEnabled ? remoteCloudHostsState.error : null,
      canRetry: remoteCloudHostsState.canRetry,
      retry: remoteCloudHostsState.retry,
    }),
    [
      discoveryEnabled,
      hostDiscoveryHasCanonicalData,
      hostDiscoveryLoading,
      remoteCloudHostsState.canRetry,
      remoteCloudHostsState.error,
      remoteCloudHostsState.isRetrying,
      remoteCloudHostsState.retry,
    ]
  );

  const availableHosts = useMemo<SettingsHostTarget[]>(() => {
    if (runtime === 'local') {
      return toLocalRuntimeTargets(remoteCloudHostsState.data?.hosts ?? [], t);
    }

    if (!remoteCloudHostsState.data) {
      return [];
    }

    return remoteCloudHostsState.data.hosts.map((host) => ({
      id: host.id,
      apiHostId: host.id,
      label: host.name,
      description: t('settings.hostPicker.remoteHost', 'Remote host'),
      status:
        host.status === 'online' ? ('online' as const) : ('offline' as const),
      kind: 'remote',
    }));
  }, [remoteCloudHostsState.data, runtime, t]);

  const [storedSelectedHostId, setSelectedHostId] =
    useState<SettingsHostTargetId | null>(null);

  useEffect(() => {
    const nextHostId = getInitialHostId(
      availableHosts,
      runtime,
      routeHostId,
      initialHostId
    );

    setSelectedHostId((current) => {
      if (initialHostId || routeHostId) {
        return nextHostId;
      }
      if (current && availableHosts.some((host) => host.id === current)) {
        return current;
      }
      return nextHostId;
    });
  }, [availableHosts, initialHostId, routeHostId, runtime]);

  // URL and route Host identity is authoritative immediately. Waiting for an
  // effect here would expose one render of the previous Host's settings.
  const selectedHostId = initialHostId ?? routeHostId ?? storedSelectedHostId;

  // Remote discovery is optional for this machine. Its failures must not
  // revoke local config writes or masquerade as local scan failures.
  const hostDiscovery = useMemo(
    () =>
      runtime === 'local' && selectedHostId === 'local'
        ? {
            hasCanonicalData: true,
            isLoading: false,
            isRetrying: false,
            error: null,
            canRetry: false,
            retry: async () => undefined,
          }
        : remoteHostDiscovery,
    [remoteHostDiscovery, runtime, selectedHostId]
  );
  const hostsResolved = !hostDiscovery.isLoading;

  const selectedHost = useMemo(
    () => availableHosts.find((host) => host.id === selectedHostId) ?? null,
    [availableHosts, selectedHostId]
  );

  const value = useMemo<SettingsHostContextValue>(
    () => ({
      availableHosts,
      hostsResolved,
      hostDiscovery,
      remoteHostDiscovery,
      selectedHostId,
      selectedHost,
      setSelectedHostId,
    }),
    [
      availableHosts,
      hostDiscovery,
      remoteHostDiscovery,
      hostsResolved,
      selectedHost,
      selectedHostId,
    ]
  );

  return (
    <SettingsHostContext.Provider value={value}>
      {children}
    </SettingsHostContext.Provider>
  );
}

export function useSettingsHost() {
  const context = useContext(SettingsHostContext);
  if (!context) {
    throw new Error(
      'useSettingsHost must be used within a SettingsHostProvider'
    );
  }
  return context;
}

export function useSettingsMachineClient(): MachineClient | null {
  const runtime = useAppRuntime();
  const { selectedHost } = useSettingsHost();

  return useMemo(() => {
    if (!selectedHost) {
      return null;
    }

    return createMachineClient(runtime, selectedHost);
  }, [runtime, selectedHost]);
}
