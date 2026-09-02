import { create } from 'zustand';

export type AppUpdateSnapshot =
  | { phase: 'initial' }
  | { phase: 'unsupported'; reason: 'not-desktop-runtime' }
  | {
      phase: 'available';
      version: string;
      releaseNotes: string | null;
    }
  | {
      phase: 'restart-ready';
      version: string;
      releaseNotes: string | null;
    };

export type AppUpdateMonitoringStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'error';

export type AppUpdateRestartStatus = 'idle' | 'pending' | 'error';

export type AppUpdateMonitoringRetry = () => Promise<void>;
export type AppUpdateRestart = () => Promise<void>;

export interface AppUpdateDataState {
  snapshot: AppUpdateSnapshot;
  monitoringStatus: AppUpdateMonitoringStatus;
  monitoringRetry: AppUpdateMonitoringRetry | null;
  restartStatus: AppUpdateRestartStatus;
  restart: AppUpdateRestart | null;
}

export type AppUpdateEvent =
  | {
      type: 'monitoring-started';
      retry: AppUpdateMonitoringRetry;
    }
  | {
      type: 'monitoring-connected';
      retry: AppUpdateMonitoringRetry;
    }
  | {
      type: 'monitoring-failed';
      retry: AppUpdateMonitoringRetry;
    }
  | { type: 'unsupported' }
  | {
      type: 'update-available';
      version: string;
      releaseNotes: string | null;
    }
  | {
      type: 'update-ready';
      version: string;
      restart: AppUpdateRestart;
    }
  | {
      type: 'restart-started';
      version: string;
      restart: AppUpdateRestart;
    }
  | {
      type: 'restart-failed';
      version: string;
      restart: AppUpdateRestart;
    };

export const INITIAL_APP_UPDATE_STATE: AppUpdateDataState = {
  snapshot: { phase: 'initial' },
  monitoringStatus: 'idle',
  monitoringRetry: null,
  restartStatus: 'idle',
  restart: null,
};

/**
 * Replays the small set of facts the desktop runtime actually reports.
 * Absence of an event never becomes "up to date", "checking", or a failure.
 */
export function reduceAppUpdateState(
  state: AppUpdateDataState,
  event: AppUpdateEvent
): AppUpdateDataState {
  switch (event.type) {
    case 'monitoring-started':
      return {
        ...state,
        snapshot:
          state.snapshot.phase === 'unsupported'
            ? { phase: 'initial' }
            : state.snapshot,
        monitoringStatus: 'connecting',
        monitoringRetry: event.retry,
      };
    case 'monitoring-connected':
      return {
        ...state,
        monitoringStatus: 'connected',
        monitoringRetry: event.retry,
      };
    case 'monitoring-failed':
      return {
        ...state,
        monitoringStatus: 'error',
        monitoringRetry: event.retry,
      };
    case 'unsupported':
      return {
        ...INITIAL_APP_UPDATE_STATE,
        snapshot: {
          phase: 'unsupported',
          reason: 'not-desktop-runtime',
        },
      };
    case 'update-available':
      if (
        state.snapshot.phase === 'restart-ready' &&
        state.snapshot.version === event.version
      ) {
        return state;
      }
      return {
        ...state,
        snapshot: {
          phase: 'available',
          version: event.version,
          releaseNotes: event.releaseNotes,
        },
        restartStatus: 'idle',
        restart: null,
      };
    case 'update-ready':
      if (
        state.snapshot.phase === 'restart-ready' &&
        state.snapshot.version === event.version
      ) {
        return state;
      }
      return {
        ...state,
        snapshot: {
          phase: 'restart-ready',
          version: event.version,
          releaseNotes:
            state.snapshot.phase === 'available' &&
            state.snapshot.version === event.version
              ? state.snapshot.releaseNotes
              : null,
        },
        restartStatus: 'idle',
        restart: event.restart,
      };
    case 'restart-started':
      if (
        state.snapshot.phase !== 'restart-ready' ||
        state.snapshot.version !== event.version ||
        state.restart !== event.restart
      ) {
        return state;
      }
      return { ...state, restartStatus: 'pending' };
    case 'restart-failed':
      if (
        state.snapshot.phase !== 'restart-ready' ||
        state.snapshot.version !== event.version ||
        state.restart !== event.restart
      ) {
        return state;
      }
      return { ...state, restartStatus: 'error' };
  }
}

interface AppUpdateStore extends AppUpdateDataState {
  monitoringStarted(retry: AppUpdateMonitoringRetry): void;
  monitoringConnected(retry: AppUpdateMonitoringRetry): void;
  monitoringFailed(retry: AppUpdateMonitoringRetry): void;
  markUnsupported(): void;
  reportAvailable(version: string, releaseNotes: string | null): void;
  reportReady(version: string, restart: AppUpdateRestart): void;
  requestRestart(): Promise<void>;
}

export const useAppUpdateStore = create<AppUpdateStore>()((set, get) => {
  const dispatch = (event: AppUpdateEvent) => {
    set((state) => reduceAppUpdateState(state, event));
  };

  return {
    ...INITIAL_APP_UPDATE_STATE,
    monitoringStarted: (retry) =>
      dispatch({ type: 'monitoring-started', retry }),
    monitoringConnected: (retry) =>
      dispatch({ type: 'monitoring-connected', retry }),
    monitoringFailed: (retry) => dispatch({ type: 'monitoring-failed', retry }),
    markUnsupported: () => dispatch({ type: 'unsupported' }),
    reportAvailable: (version, releaseNotes) =>
      dispatch({ type: 'update-available', version, releaseNotes }),
    reportReady: (version, restart) =>
      dispatch({ type: 'update-ready', version, restart }),
    requestRestart: async () => {
      const { snapshot, restartStatus, restart } = get();
      if (
        snapshot.phase !== 'restart-ready' ||
        restartStatus === 'pending' ||
        !restart
      ) {
        return;
      }

      const version = snapshot.version;
      dispatch({ type: 'restart-started', version, restart });
      try {
        await restart();
      } catch {
        dispatch({ type: 'restart-failed', version, restart });
      }
    },
  };
});
