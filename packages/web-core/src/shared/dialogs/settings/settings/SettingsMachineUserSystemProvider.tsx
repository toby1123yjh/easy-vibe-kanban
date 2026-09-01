import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { UserSystemContext } from '@/shared/hooks/useUserSystem';
import { useUserSystemController } from '@/shared/hooks/useUserSystemController';
import {
  useSettingsHost,
  useSettingsMachineClient,
} from './SettingsHostContext';

interface SettingsMachineState {
  hasCanonicalData: boolean;
  isLoading: boolean;
  isRetrying: boolean;
  error: unknown;
  canMutate: boolean;
  retry: () => Promise<void>;
}

const SettingsMachineStateContext = createContext<SettingsMachineState | null>(
  null
);

export function SettingsMachineUserSystemProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { hostDiscovery, selectedHost } = useSettingsHost();
  const machineClient = useSettingsMachineClient();
  const queryKey = useMemo(() => {
    if (machineClient?.target.kind === 'local') {
      return ['user-system', 'local'] as const;
    }

    return [
      'user-system',
      'settings-machine',
      machineClient?.target.id ?? 'unselected',
    ] as const;
  }, [machineClient]);
  const loadConfig = useCallback(() => {
    if (!machineClient) {
      throw new Error('Machine client is required');
    }

    return machineClient.getConfig();
  }, [machineClient]);
  const saveConfig = useCallback(
    (
      config: Parameters<NonNullable<typeof machineClient>['saveConfig']>[0]
    ) => {
      if (!machineClient) {
        throw new Error('Machine client is required');
      }

      return machineClient.saveConfig(config);
    },
    [machineClient]
  );

  const { value, userSystemInfo, isLoading, error, refetch } =
    useUserSystemController({
      queryKey,
      enabled: machineClient != null,
      load: loadConfig,
      save: saveConfig,
    });
  const machineIdentity = `${machineClient?.target.kind ?? 'unselected'}:${machineClient?.target.id ?? 'unselected'}`;
  const retryIdentityRef = useRef(machineIdentity);
  const retryEpochRef = useRef(0);
  const retryPendingEpochRef = useRef<number | null>(null);
  const [retryPendingEpoch, setRetryPendingEpoch] = useState<number | null>(
    null
  );

  useEffect(() => {
    retryIdentityRef.current = machineIdentity;
    retryPendingEpochRef.current = null;
    setRetryPendingEpoch(null);

    return () => {
      retryEpochRef.current += 1;
      retryPendingEpochRef.current = null;
    };
  }, [machineIdentity]);

  const isRetrying =
    retryPendingEpoch === retryEpochRef.current &&
    retryPendingEpochRef.current === retryPendingEpoch;

  const retry = useCallback(async () => {
    const epoch = retryEpochRef.current;
    if (
      !machineClient ||
      retryIdentityRef.current !== machineIdentity ||
      retryPendingEpochRef.current === epoch
    ) {
      return;
    }

    retryPendingEpochRef.current = epoch;
    setRetryPendingEpoch(epoch);
    try {
      await refetch();
    } finally {
      if (
        retryIdentityRef.current === machineIdentity &&
        retryEpochRef.current === epoch &&
        retryPendingEpochRef.current === epoch
      ) {
        retryPendingEpochRef.current = null;
        setRetryPendingEpoch(null);
      }
    }
  }, [machineClient, machineIdentity, refetch]);

  const machineState = useMemo<SettingsMachineState>(
    () => ({
      hasCanonicalData: userSystemInfo !== undefined,
      isLoading,
      isRetrying,
      error,
      canMutate:
        machineClient != null &&
        selectedHost != null &&
        !(
          selectedHost.kind === 'remote' && selectedHost.status === 'offline'
        ) &&
        hostDiscovery.hasCanonicalData &&
        hostDiscovery.error == null &&
        userSystemInfo !== undefined &&
        error == null &&
        !isLoading,
      retry,
    }),
    [
      error,
      hostDiscovery.error,
      hostDiscovery.hasCanonicalData,
      isLoading,
      isRetrying,
      machineClient,
      retry,
      selectedHost,
      userSystemInfo,
    ]
  );

  return (
    <SettingsMachineStateContext.Provider value={machineState}>
      <UserSystemContext.Provider value={value}>
        {children}
      </UserSystemContext.Provider>
    </SettingsMachineStateContext.Provider>
  );
}

export function useSettingsMachineState(): SettingsMachineState {
  const context = useContext(SettingsMachineStateContext);
  if (!context) {
    throw new Error(
      'useSettingsMachineState must be used within a SettingsMachineUserSystemProvider'
    );
  }
  return context;
}
