import { useEffect } from 'react';
import { isTauriApp } from '@/shared/lib/platform';
import { useAppUpdateStore } from '@/shared/stores/useAppUpdateStore';

interface UpdateAvailablePayload {
  newVersion: string;
  body?: string | null;
}

interface UpdateReadyPayload {
  newVersion: string;
}

function validVersion(version: unknown): version is string {
  return typeof version === 'string' && version.trim().length > 0;
}

/**
 * Owns the single frontend subscription to the Tauri updater lifecycle.
 *
 * The current runtime reports only `update-available` and
 * `update-installed` (downloaded/restart-ready). It does not report check
 * start/success/failure or download progress/failure, so this bridge does not
 * infer those states from silence.
 */
export function useTauriUpdateLifecycle() {
  const markUnsupported = useAppUpdateStore((state) => state.markUnsupported);
  const monitoringStarted = useAppUpdateStore(
    (state) => state.monitoringStarted
  );
  const monitoringConnected = useAppUpdateStore(
    (state) => state.monitoringConnected
  );
  const monitoringFailed = useAppUpdateStore((state) => state.monitoringFailed);
  const reportAvailable = useAppUpdateStore((state) => state.reportAvailable);
  const reportReady = useAppUpdateStore((state) => state.reportReady);

  useEffect(() => {
    if (!isTauriApp()) {
      markUnsupported();
      return;
    }

    let disposed = false;
    let connectEpoch = 0;
    let connectPending = false;
    let unlisteners: Array<() => void> = [];

    const clearListeners = () => {
      for (const unlisten of unlisteners) unlisten();
      unlisteners = [];
    };

    const connect = async () => {
      if (disposed || connectPending) return;

      connectPending = true;
      const epoch = ++connectEpoch;
      monitoringStarted(connect);
      const pendingUnlisteners: Array<() => void> = [];

      try {
        const { emit, listen } = await import('@tauri-apps/api/event');
        const restart = () => emit('restart-app');

        // Subscribe to restart-ready first. If setup overlaps a fast download,
        // retaining the actionable terminal fact is more important than the
        // earlier available notification (there is no replay API yet).
        const unlistenReady = await listen<UpdateReadyPayload>(
          'update-installed',
          (event) => {
            if (disposed || !validVersion(event.payload.newVersion)) return;
            reportReady(event.payload.newVersion.trim(), restart);
          }
        );
        if (disposed || epoch !== connectEpoch) {
          unlistenReady();
          return;
        }
        pendingUnlisteners.push(unlistenReady);

        const unlistenAvailable = await listen<UpdateAvailablePayload>(
          'update-available',
          (event) => {
            if (disposed || !validVersion(event.payload.newVersion)) return;
            reportAvailable(
              event.payload.newVersion.trim(),
              typeof event.payload.body === 'string' ? event.payload.body : null
            );
          }
        );
        if (disposed || epoch !== connectEpoch) {
          unlistenAvailable();
          for (const unlisten of pendingUnlisteners) unlisten();
          pendingUnlisteners.length = 0;
          return;
        }
        pendingUnlisteners.push(unlistenAvailable);

        clearListeners();
        unlisteners = pendingUnlisteners;
        monitoringConnected(connect);
      } catch {
        for (const unlisten of pendingUnlisteners) unlisten();
        if (!disposed && epoch === connectEpoch) {
          monitoringFailed(connect);
        }
      } finally {
        if (epoch === connectEpoch) connectPending = false;
      }
    };

    void connect();
    return () => {
      disposed = true;
      connectEpoch += 1;
      clearListeners();
    };
  }, [
    markUnsupported,
    monitoringConnected,
    monitoringFailed,
    monitoringStarted,
    reportAvailable,
    reportReady,
  ]);
}
