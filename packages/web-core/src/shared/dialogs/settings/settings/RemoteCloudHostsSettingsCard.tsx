import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Button } from '@vibe/ui/components/Button';
import { ConfirmDialog } from '@vibe/ui/components/ConfirmDialog';
import { PrimaryButton } from '@vibe/ui/components/PrimaryButton';
import {
  DegradedState,
  EmptyState,
  ErrorState,
  LoadingState,
} from '@vibe/ui/components/StateSurface';
import {
  usePairRemoteCloudHostMutation,
  useRemoteCloudHostsState,
  useRemoveRemoteCloudHostMutation,
  type RemoteCloudHost,
} from '@/shared/hooks/useRemoteCloudHosts';
import type { RelayHost } from 'shared/remote-types';
import {
  SettingsField,
  SettingsInput,
  SettingsSelect,
} from './SettingsComponents';
import { PairingCodeInput } from './PairingCodeInput';
import { normalizeEnrollmentCode } from '@/shared/lib/relayPake';
import { useUserSystem } from '@/shared/hooks/useUserSystem';
import {
  usePairRelayHostMutation,
  useRemovePairedRelayHostMutation,
} from './useRelayRemoteHostMutations';
import { createRelayClientIdentity } from '@/shared/lib/relayClientIdentity';

const EMPTY_CONNECTED_HOSTS: RemoteCloudHost[] = [];
const EMPTY_RELAY_HOSTS: RelayHost[] = [];

interface CloudHostMutationState {
  canMutate: boolean;
  scopeIdentity: 'local' | 'remote' | 'unmounted';
  connectedHosts: RemoteCloudHost[];
  pairableRelayHosts: RelayHost[];
}

interface ActiveCloudHostMutation {
  type: 'pair' | 'remove';
  hostId: string;
}

export function RemoteCloudHostsSettingsCardContent({
  initialHostId,
  mode = 'local',
  onClose,
}: {
  initialHostId?: string;
  mode?: 'local' | 'remote';
  onClose?: () => void;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const navigate = useNavigate();
  const { hostId: routeHostId } = useParams({ strict: false });
  const [hostName, setHostName] = useState('');
  const [selectedHostId, setSelectedHostId] = useState<string | undefined>();
  const [pairingCode, setPairingCode] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [activeMutation, setActiveMutation] =
    useState<ActiveCloudHostMutation | null>(null);
  const appliedInitialHostIdRef = useRef<string | null>(null);
  const { machineId } = useUserSystem();

  const isRemoteMode = mode === 'remote';
  const cloudHostsState = useRemoteCloudHostsState();
  const relayHosts = cloudHostsState.data?.relayHosts ?? EMPTY_RELAY_HOSTS;
  const connectedHosts = cloudHostsState.data?.hosts ?? EMPTY_CONNECTED_HOSTS;
  const { mutateAsync: pairLocalHost } = usePairRemoteCloudHostMutation();
  const { mutateAsync: removeLocalHost } = useRemoveRemoteCloudHostMutation();
  const { mutateAsync: pairRemoteHost } = usePairRelayHostMutation();
  const { mutateAsync: removeRemoteHost } = useRemovePairedRelayHostMutation();
  const isDevMode = import.meta.env.DEV;
  const pairableRelayHosts = useMemo(() => {
    if (isRemoteMode || !machineId || isDevMode) {
      return relayHosts;
    }

    return relayHosts.filter((host) => host.machine_id !== machineId);
  }, [isDevMode, isRemoteMode, machineId, relayHosts]);
  const defaultClientName = useMemo(
    () => createRelayClientIdentity().clientName,
    []
  );

  useEffect(() => {
    if (pairableRelayHosts.length === 0) {
      setSelectedHostId(undefined);
      return;
    }

    if (!selectedHostId) {
      setSelectedHostId(pairableRelayHosts[0].id);
      return;
    }

    if (!pairableRelayHosts.some((host) => host.id === selectedHostId)) {
      setSelectedHostId(pairableRelayHosts[0].id);
    }
  }, [pairableRelayHosts, selectedHostId]);

  useEffect(() => {
    if (!initialHostId) {
      appliedInitialHostIdRef.current = null;
      return;
    }

    if (appliedInitialHostIdRef.current === initialHostId) {
      return;
    }

    if (!cloudHostsState.hasCanonicalData) {
      return;
    }

    const initialHost = pairableRelayHosts.find(
      (host) => host.id === initialHostId
    );
    if (!initialHost) {
      appliedInitialHostIdRef.current = initialHostId;
      return;
    }

    setSelectedHostId(initialHost.id);
    setErrorMessage(null);
    setSuccessMessage(null);
    appliedInitialHostIdRef.current = initialHostId;
  }, [cloudHostsState.hasCanonicalData, initialHostId, pairableRelayHosts]);

  const relayHostOptions = useMemo(
    () =>
      pairableRelayHosts.map((host) => ({
        value: host.id,
        label: host.name,
      })),
    [pairableRelayHosts]
  );

  const hasCanonicalData = cloudHostsState.hasCanonicalData;
  const isInitialLoading = !hasCanonicalData && cloudHostsState.isLoading;
  const isInitialError = !hasCanonicalData && cloudHostsState.error != null;
  const isDegraded = hasCanonicalData && cloudHostsState.error != null;
  const mutationsDisabled =
    !hasCanonicalData ||
    cloudHostsState.error != null ||
    cloudHostsState.isFetching ||
    activeMutation != null;
  const mutationStateRef = useRef<CloudHostMutationState>({
    canMutate: !mutationsDisabled,
    scopeIdentity: mode,
    connectedHosts,
    pairableRelayHosts,
  });
  const mutationOperationRef = useRef<ActiveCloudHostMutation | null>(null);
  const removeConfirmationPendingRef = useRef(false);
  mutationStateRef.current = {
    canMutate: !mutationsDisabled,
    scopeIdentity: mode,
    connectedHosts,
    pairableRelayHosts,
  };

  useEffect(() => {
    mutationStateRef.current = {
      canMutate: !mutationsDisabled,
      scopeIdentity: mode,
      connectedHosts,
      pairableRelayHosts,
    };

    return () => {
      mutationStateRef.current = {
        canMutate: false,
        scopeIdentity: 'unmounted',
        connectedHosts: [],
        pairableRelayHosts: [],
      };
    };
  }, [connectedHosts, mode, mutationsDisabled, pairableRelayHosts]);

  const canSubmitPairing =
    !!selectedHostId &&
    normalizeEnrollmentCode(pairingCode).length === 6 &&
    !mutationsDisabled;

  const resetForm = () => {
    setHostName('');
    setPairingCode('');
  };

  const rejectUnavailableMutation = () => {
    if (mutationStateRef.current.scopeIdentity === 'unmounted') return;

    setErrorMessage(
      t(
        'settings.relay.remoteCloudHost.refreshRequired',
        'Host information changed or could not be refreshed. Retry before changing connected hosts.'
      )
    );
  };

  const handleConnect = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    const currentState = mutationStateRef.current;
    if (mutationOperationRef.current || !currentState.canMutate) {
      rejectUnavailableMutation();
      return;
    }

    if (!selectedHostId) {
      setErrorMessage(
        t(
          'settings.relay.remoteCloudHost.hostRequired',
          'Select a host to connect.'
        )
      );
      return;
    }

    const selectedHost = currentState.pairableRelayHosts.find(
      (host) => host.id === selectedHostId
    );
    if (!selectedHost) {
      setErrorMessage(
        t(
          'settings.relay.remoteCloudHost.hostMissing',
          'Selected host is no longer available.'
        )
      );
      return;
    }

    const normalizedCode = normalizeEnrollmentCode(pairingCode);
    if (normalizedCode.length !== 6) {
      setErrorMessage(
        t(
          'settings.relay.remoteCloudHost.invalidPairingCode',
          'Enter the complete 6-character pairing code.'
        )
      );
      return;
    }
    const effectiveHostName = hostName.trim() || defaultClientName;
    const initiatingScope = currentState.scopeIdentity;
    const operation = { type: 'pair' as const, hostId: selectedHost.id };

    mutationOperationRef.current = operation;
    setActiveMutation(operation);
    try {
      if (isRemoteMode) {
        await pairRemoteHost({
          hostId: selectedHost.id,
          hostName: effectiveHostName,
          normalizedCode,
        });
      } else {
        await pairLocalHost({
          host_id: selectedHost.id,
          host_name: effectiveHostName,
          enrollment_code: normalizedCode,
        });
      }
      if (mutationStateRef.current.scopeIdentity !== initiatingScope) return;

      setSuccessMessage(
        t(
          'settings.relay.remoteCloudHost.connectSuccess',
          'Remote Cloud Host connected.'
        )
      );
      resetForm();
    } catch (error) {
      if (mutationStateRef.current.scopeIdentity === initiatingScope) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (mutationOperationRef.current === operation) {
        mutationOperationRef.current = null;
        if (mutationStateRef.current.scopeIdentity !== 'unmounted') {
          setActiveMutation(null);
        }
      }
    }
  };

  const handleRemove = async (hostId: string) => {
    const initiatingState = mutationStateRef.current;
    if (
      mutationOperationRef.current ||
      removeConfirmationPendingRef.current ||
      !initiatingState.canMutate ||
      !initiatingState.connectedHosts.some((host) => host.id === hostId)
    ) {
      rejectUnavailableMutation();
      return;
    }

    removeConfirmationPendingRef.current = true;
    let result: Awaited<ReturnType<typeof ConfirmDialog.show>>;
    try {
      result = await ConfirmDialog.show({
        title: t(
          'settings.relay.remoteCloudHost.removeTitle',
          'Remove connected host?'
        ),
        message: t(
          'settings.relay.remoteCloudHost.removeConfirm',
          'Remove this remote cloud host connection?'
        ),
        confirmText: t('settings.relay.remoteCloudHost.remove', 'Remove'),
        cancelText: t('common:buttons.cancel', 'Cancel'),
        variant: 'destructive',
      });
    } catch (error) {
      if (mutationStateRef.current.scopeIdentity !== 'unmounted') {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
      return;
    } finally {
      removeConfirmationPendingRef.current = false;
    }

    if (result !== 'confirmed') {
      return;
    }

    const currentState = mutationStateRef.current;
    if (
      mutationOperationRef.current ||
      !currentState.canMutate ||
      currentState.scopeIdentity !== initiatingState.scopeIdentity ||
      !currentState.connectedHosts.some((host) => host.id === hostId)
    ) {
      rejectUnavailableMutation();
      return;
    }

    const operation = { type: 'remove' as const, hostId };
    mutationOperationRef.current = operation;
    setActiveMutation(operation);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      if (isRemoteMode) {
        await removeRemoteHost(hostId);
      } else {
        await removeLocalHost(hostId);
      }
      if (
        mutationStateRef.current.scopeIdentity ===
          initiatingState.scopeIdentity &&
        hostId === routeHostId
      ) {
        void navigate({ to: '/' });
      }
    } catch (error) {
      if (
        mutationStateRef.current.scopeIdentity === initiatingState.scopeIdentity
      ) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (mutationOperationRef.current === operation) {
        mutationOperationRef.current = null;
        if (mutationStateRef.current.scopeIdentity !== 'unmounted') {
          setActiveMutation(null);
        }
      }
    }
  };

  const handleGoToHostWorkspaces = (hostId: string, status?: string) => {
    if (status === 'offline') {
      return;
    }

    onClose?.();
    void navigate({
      to: '/hosts/$hostId/workspaces',
      params: { hostId },
    });
  };

  const retryAction = (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      loading={cloudHostsState.isRetrying}
      loadingLabel={t(
        'settings.relay.remoteCloudHost.retrying',
        'Retrying host refresh'
      )}
      disabled={!cloudHostsState.canRetry}
      onClick={() => void cloudHostsState.retry()}
    >
      {t('settings.relay.remoteCloudHost.retry', 'Retry')}
    </Button>
  );

  if (isInitialLoading) {
    return (
      <LoadingState
        compact
        className="min-w-0 overflow-hidden"
        title={t(
          'settings.relay.remoteCloudHost.loading',
          'Loading remote cloud hosts…'
        )}
      />
    );
  }

  if (isInitialError) {
    return (
      <ErrorState
        compact
        className="min-w-0 overflow-hidden"
        title={t(
          'settings.relay.remoteCloudHost.loadErrorTitle',
          'Remote cloud hosts could not be loaded'
        )}
        description={t(
          'settings.relay.remoteCloudHost.loadError',
          'Try loading the available and connected hosts again.'
        )}
        action={retryAction}
      />
    );
  }

  return (
    <div
      className="min-w-0 space-y-4 overflow-hidden"
      aria-busy={cloudHostsState.isFetching || undefined}
    >
      {isDegraded && (
        <DegradedState
          compact
          title={t(
            'settings.relay.remoteCloudHost.degradedTitle',
            'Host connections are temporarily read-only'
          )}
          description={t(
            'settings.relay.remoteCloudHost.degraded',
            'Previously loaded hosts remain available, but pairing and removal are disabled until refresh succeeds.'
          )}
          action={retryAction}
        />
      )}

      {successMessage && (
        <div
          role="status"
          className="break-words rounded-sm border border-success/50 bg-success/10 p-3 text-sm text-success"
        >
          {successMessage}
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="break-words rounded-sm border border-error/50 bg-error/10 p-3 text-sm text-error"
        >
          {errorMessage}
        </div>
      )}

      <fieldset disabled={mutationsDisabled} className="min-w-0 space-y-4">
        <SettingsField
          label={t('settings.relay.client.pair.hostLabel', 'Host to pair to')}
        >
          <SettingsSelect
            value={selectedHostId}
            options={relayHostOptions}
            onChange={setSelectedHostId}
            placeholder={t(
              'settings.relay.remoteCloudHost.hostPlaceholder',
              pairableRelayHosts.length === 0
                ? 'No hosts available'
                : 'Select a host'
            )}
            disabled={mutationsDisabled || relayHostOptions.length === 0}
          />
        </SettingsField>

        {pairableRelayHosts.length === 0 && (
          <p className="break-words text-sm text-low">
            {t(
              'settings.relay.remoteCloudHost.hostsUnavailable',
              'No hosts found yet. Make sure another device is running as a host and has paired with this account.'
            )}
          </p>
        )}

        {selectedHostId && (
          <>
            <SettingsField
              label={t(
                'settings.relay.client.pair.nameLabel',
                'How this device appears on that host (optional)'
              )}
            >
              <SettingsInput
                value={hostName}
                onChange={setHostName}
                placeholder={t(
                  'settings.relay.remoteCloudHost.namePlaceholder',
                  defaultClientName
                )}
              />
            </SettingsField>

            <SettingsField
              label={t(
                'settings.relay.client.pair.pairingCodeLabel',
                'Pairing code from the host'
              )}
              description={t(
                'settings.relay.client.pair.pairingCodeHelp',
                'Enter the 6-character code shown on the host you want to connect to.'
              )}
            >
              <PairingCodeInput value={pairingCode} onChange={setPairingCode} />
            </SettingsField>

            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <PrimaryButton
                value={t(
                  'settings.relay.client.pair.confirm',
                  'Pair this device'
                )}
                onClick={() => void handleConnect()}
                disabled={!canSubmitPairing}
                actionIcon={
                  activeMutation?.type === 'pair' ? 'spinner' : undefined
                }
              />
              <PrimaryButton
                variant="tertiary"
                value={t('common:buttons.cancel')}
                onClick={resetForm}
                disabled={mutationsDisabled}
              />
            </div>
          </>
        )}
      </fieldset>

      <hr className="border-border" />

      <section className="min-w-0 space-y-2">
        <h3 className="text-sm font-medium text-normal">
          {t('settings.relay.client.connectedHosts.title', 'Connected hosts')}
        </h3>

        {connectedHosts.length === 0 ? (
          <EmptyState
            compact
            title={t(
              'settings.relay.remoteCloudHost.empty',
              'No hosts paired yet.'
            )}
          />
        ) : (
          <div className="min-w-0 space-y-2">
            {connectedHosts.map((host) => {
              const isOffline = host.status === 'offline';

              return (
                <div
                  key={host.id}
                  className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-secondary/30 p-3"
                >
                  <button
                    type="button"
                    disabled={isOffline}
                    className="min-w-0 flex-1 basis-48 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-80 enabled:hover:text-high"
                    onClick={() =>
                      void handleGoToHostWorkspaces(host.id, host.status)
                    }
                  >
                    <p className="truncate text-sm font-medium text-high">
                      {host.name}
                    </p>
                    <p className="truncate text-xs text-low">
                      {isRemoteMode && host.status
                        ? `${host.status === 'online' ? 'Online' : 'Offline'}${host.pairedAt ? ` · Paired ${new Date(host.pairedAt).toLocaleDateString()}` : ''}`
                        : host.id}
                    </p>
                  </button>
                  <span
                    className="max-w-full shrink-0"
                    data-relay-host-action="remove"
                  >
                    <PrimaryButton
                      variant="tertiary"
                      value={t(
                        'settings.relay.remoteCloudHost.remove',
                        'Remove'
                      )}
                      onClick={() => void handleRemove(host.id)}
                      disabled={mutationsDisabled}
                      actionIcon={
                        activeMutation?.type === 'remove' &&
                        activeMutation.hostId === host.id
                          ? 'spinner'
                          : undefined
                      }
                    />
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
