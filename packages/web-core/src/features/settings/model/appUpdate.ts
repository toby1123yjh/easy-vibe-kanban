import type {
  AppUpdateMonitoringStatus,
  AppUpdateRestartStatus,
  AppUpdateSnapshot,
} from '@/shared/stores/useAppUpdateStore';

export type AppUpdateSurfaceProjection =
  | {
      kind: 'unavailable';
      reason: 'remote-runtime' | 'remote-host' | 'host-unavailable' | 'browser';
    }
  | { kind: 'connecting' }
  | { kind: 'monitoring-error' }
  | { kind: 'initial' }
  | {
      kind: 'available';
      version: string;
      releaseNotes: string | null;
      degraded: boolean;
    }
  | {
      kind: 'restart-ready';
      version: string;
      releaseNotes: string | null;
      degraded: boolean;
      restartStatus: AppUpdateRestartStatus;
    };

interface ProjectAppUpdateSurfaceOptions {
  runtime: 'local' | 'remote';
  hostKind: 'local' | 'remote' | null;
  snapshot: AppUpdateSnapshot;
  monitoringStatus: AppUpdateMonitoringStatus;
  restartStatus: AppUpdateRestartStatus;
}

/**
 * Projects only facts owned by the selected runtime and Host. In particular,
 * a connected monitor with no update event remains Initial rather than being
 * presented as an up-to-date result.
 */
export function projectAppUpdateSurface({
  runtime,
  hostKind,
  snapshot,
  monitoringStatus,
  restartStatus,
}: ProjectAppUpdateSurfaceOptions): AppUpdateSurfaceProjection {
  if (runtime === 'remote') {
    return { kind: 'unavailable', reason: 'remote-runtime' };
  }
  if (hostKind === 'remote') {
    return { kind: 'unavailable', reason: 'remote-host' };
  }
  if (hostKind == null) {
    return { kind: 'unavailable', reason: 'host-unavailable' };
  }
  if (snapshot.phase === 'unsupported') {
    return { kind: 'unavailable', reason: 'browser' };
  }

  if (snapshot.phase === 'initial') {
    if (monitoringStatus === 'idle' || monitoringStatus === 'connecting') {
      return { kind: 'connecting' };
    }
    if (monitoringStatus === 'error') return { kind: 'monitoring-error' };
    return { kind: 'initial' };
  }

  const degraded = monitoringStatus !== 'connected';
  if (snapshot.phase === 'available') {
    return {
      kind: 'available',
      version: snapshot.version,
      releaseNotes: snapshot.releaseNotes,
      degraded,
    };
  }

  return {
    kind: 'restart-ready',
    version: snapshot.version,
    releaseNotes: snapshot.releaseNotes,
    degraded,
    restartStatus,
  };
}
