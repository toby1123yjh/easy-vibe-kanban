import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BaseCodingAgent,
  type ExecutorConfig,
  type ExecutorProfile,
  type ExecutorProfileId,
} from 'shared/types';
import { sessionsApi } from '@/shared/lib/api';
import { restoreExecutorConfig } from '@/shared/lib/executorConfig';
import { useExecutorConfig } from '@/shared/hooks/useExecutorConfig';
import { useHostId } from '@/shared/providers/HostIdProvider';
import { sessionExecutorConfigKey } from '@/shared/hooks/sessionExecutorConfigKeys';

interface UseSessionExecutorConfigOptions {
  sessionId?: string;
  workspaceId?: string;
  sessionExecutor?: string | null;
  isNewSessionMode: boolean;
  preferredExecutorConfig?: ExecutorConfig | null;
  scratchConfig?: ExecutorConfig | null;
  isScratchLoading?: boolean;
  profiles: Record<string, ExecutorProfile> | null;
  configExecutorProfile?: ExecutorProfileId | null;
  hiddenAgents?: readonly BaseCodingAgent[] | null;
  onPersist?: (config: ExecutorConfig) => void;
}

/** Restore only this session's durable request; drafts never own its binding. */
export function useSessionExecutorConfig({
  sessionId,
  workspaceId,
  sessionExecutor,
  isNewSessionMode,
  preferredExecutorConfig,
  scratchConfig,
  isScratchLoading = false,
  ...options
}: UseSessionExecutorConfigOptions) {
  const hostId = useHostId();
  const existingSession = !isNewSessionMode && !!sessionId;
  const query = useQuery({
    queryKey: sessionExecutorConfigKey(hostId, sessionId),
    queryFn: () => sessionsApi.getExecutorConfig(sessionId!, hostId),
    enabled: existingSession,
    retry: false,
    // Reopening must observe a run sent by another mounted view/tab as well.
    staleTime: 0,
  });
  const restored = useMemo(
    () => (query.data ? restoreExecutorConfig(query.data) : null),
    [query.data]
  );
  const boundExecutor = Object.values(BaseCodingAgent).find(
    (agent) => agent === sessionExecutor
  );
  const configError =
    (existingSession ? query.error : null) ??
    (existingSession && sessionExecutor && !boundExecutor
      ? new Error(`Unknown session executor: ${sessionExecutor}`)
      : null) ??
    (existingSession &&
    restored &&
    boundExecutor &&
    restored.executor !== boundExecutor
      ? new Error('Stored executor configuration does not match this session')
      : null);
  const isConfigLoading =
    isScratchLoading ||
    (existingSession && (query.isPending || query.isFetching));
  const isConfigReady = !isConfigLoading && !configError;
  const selection = useExecutorConfig({
    ...options,
    scopeKey: JSON.stringify([
      hostId,
      sessionId ?? workspaceId,
      isNewSessionMode,
    ]),
    enabled: isConfigReady,
    lockedExecutor: existingSession ? boundExecutor : null,
    lockedConfig: existingSession ? restored : null,
    lastUsedConfig: existingSession
      ? (restored ??
        (!boundExecutor ? (preferredExecutorConfig ?? null) : null))
      : (preferredExecutorConfig ?? null),
    // Embedded workflow defaults are initial values, never session overrides.
    // Bound-session drafts are complete snapshots. Rust omits null fields on
    // serialization, so restore those as Follow CLI instead of old run values.
    scratchConfig: isScratchLoading
      ? undefined
      : existingSession && restored && scratchConfig
        ? restoreExecutorConfig(scratchConfig)
        : scratchConfig,
  });
  return {
    ...selection,
    // ModelSelector already renders an empty options list as a disabled current preset.
    variantOptions: existingSession && restored ? [] : selection.variantOptions,
    executorConfig: isConfigReady ? selection.executorConfig : null,
    isConfigLoading,
    configError,
    refetchConfig: query.refetch,
    needsExecutorSelection: isNewSessionMode || (!boundExecutor && !restored),
  };
}
