import { expect, test } from '@playwright/test';
import {
  INITIAL_APP_UPDATE_STATE,
  reduceAppUpdateState,
  type AppUpdateRestart,
} from '@/shared/stores/useAppUpdateStore';
import { projectAppUpdateSurface } from './appUpdate';

const retry = async () => {};
const restart: AppUpdateRestart = async () => {};

test.describe('Application update lifecycle projection', () => {
  test('does not translate runtime silence into an up-to-date result', () => {
    expect(
      projectAppUpdateSurface({
        runtime: 'local',
        hostKind: 'local',
        snapshot: { phase: 'initial' },
        monitoringStatus: 'connected',
        restartStatus: 'idle',
      })
    ).toEqual({ kind: 'initial' });
  });

  test('distinguishes listener connection and listener failure', () => {
    expect(
      projectAppUpdateSurface({
        runtime: 'local',
        hostKind: 'local',
        snapshot: { phase: 'initial' },
        monitoringStatus: 'idle',
        restartStatus: 'idle',
      })
    ).toEqual({ kind: 'connecting' });
    expect(
      projectAppUpdateSurface({
        runtime: 'local',
        hostKind: 'local',
        snapshot: { phase: 'initial' },
        monitoringStatus: 'connecting',
        restartStatus: 'idle',
      })
    ).toEqual({ kind: 'connecting' });
    expect(
      projectAppUpdateSurface({
        runtime: 'local',
        hostKind: 'local',
        snapshot: { phase: 'initial' },
        monitoringStatus: 'error',
        restartStatus: 'idle',
      })
    ).toEqual({ kind: 'monitoring-error' });
  });

  test('keeps deployment and Host update capabilities explicit', () => {
    const base = {
      snapshot: { phase: 'initial' } as const,
      monitoringStatus: 'connected' as const,
      restartStatus: 'idle' as const,
    };

    expect(
      projectAppUpdateSurface({
        ...base,
        runtime: 'remote',
        hostKind: 'local',
      })
    ).toEqual({ kind: 'unavailable', reason: 'remote-runtime' });
    expect(
      projectAppUpdateSurface({
        ...base,
        runtime: 'local',
        hostKind: 'remote',
      })
    ).toEqual({ kind: 'unavailable', reason: 'remote-host' });
    expect(
      projectAppUpdateSurface({
        ...base,
        runtime: 'local',
        hostKind: 'local',
        snapshot: {
          phase: 'unsupported',
          reason: 'not-desktop-runtime',
        },
      })
    ).toEqual({ kind: 'unavailable', reason: 'browser' });
  });

  test('preserves a reported update as Degraded when monitoring fails', () => {
    expect(
      projectAppUpdateSurface({
        runtime: 'local',
        hostKind: 'local',
        snapshot: {
          phase: 'available',
          version: '2.0.0',
          releaseNotes: 'Notes',
        },
        monitoringStatus: 'error',
        restartStatus: 'idle',
      })
    ).toEqual({
      kind: 'available',
      version: '2.0.0',
      releaseNotes: 'Notes',
      degraded: true,
    });

    expect(
      projectAppUpdateSurface({
        runtime: 'local',
        hostKind: 'local',
        snapshot: {
          phase: 'available',
          version: '2.0.0',
          releaseNotes: 'Notes',
        },
        monitoringStatus: 'connecting',
        restartStatus: 'idle',
      })
    ).toEqual({
      kind: 'available',
      version: '2.0.0',
      releaseNotes: 'Notes',
      degraded: true,
    });
  });

  test('retains release notes through the ready event and ignores reordering', () => {
    const available = reduceAppUpdateState(INITIAL_APP_UPDATE_STATE, {
      type: 'update-available',
      version: '2.0.0',
      releaseNotes: 'Notes',
    });
    const ready = reduceAppUpdateState(available, {
      type: 'update-ready',
      version: '2.0.0',
      restart,
    });
    const reordered = reduceAppUpdateState(ready, {
      type: 'update-available',
      version: '2.0.0',
      releaseNotes: null,
    });

    expect(ready.snapshot).toEqual({
      phase: 'restart-ready',
      version: '2.0.0',
      releaseNotes: 'Notes',
    });
    expect(reordered).toBe(ready);
  });

  test('preserves useful ready data when monitoring degrades', () => {
    const ready = reduceAppUpdateState(INITIAL_APP_UPDATE_STATE, {
      type: 'update-ready',
      version: '2.0.0',
      restart,
    });
    const degraded = reduceAppUpdateState(ready, {
      type: 'monitoring-failed',
      retry,
    });

    expect(degraded.snapshot).toBe(ready.snapshot);
    expect(degraded.monitoringStatus).toBe('error');
    expect(degraded.monitoringRetry).toBe(retry);
  });

  test('ignores a stale restart failure after a newer ready event', () => {
    const oldRestart: AppUpdateRestart = async () => {};
    const nextRestart: AppUpdateRestart = async () => {};
    const oldReady = reduceAppUpdateState(INITIAL_APP_UPDATE_STATE, {
      type: 'update-ready',
      version: '2.0.0',
      restart: oldRestart,
    });
    const oldPending = reduceAppUpdateState(oldReady, {
      type: 'restart-started',
      version: '2.0.0',
      restart: oldRestart,
    });
    const nextReady = reduceAppUpdateState(oldPending, {
      type: 'update-ready',
      version: '2.1.0',
      restart: nextRestart,
    });
    const staleFailure = reduceAppUpdateState(nextReady, {
      type: 'restart-failed',
      version: '2.0.0',
      restart: oldRestart,
    });

    expect(staleFailure).toBe(nextReady);
    expect(staleFailure.restartStatus).toBe('idle');
  });

  test('does not reopen a same-version restart while it is pending', () => {
    const firstRestart: AppUpdateRestart = async () => {};
    const duplicateRestart: AppUpdateRestart = async () => {};
    const ready = reduceAppUpdateState(INITIAL_APP_UPDATE_STATE, {
      type: 'update-ready',
      version: '2.0.0',
      restart: firstRestart,
    });
    const pending = reduceAppUpdateState(ready, {
      type: 'restart-started',
      version: '2.0.0',
      restart: firstRestart,
    });
    const duplicateReady = reduceAppUpdateState(pending, {
      type: 'update-ready',
      version: '2.0.0',
      restart: duplicateRestart,
    });

    expect(duplicateReady).toBe(pending);
    expect(duplicateReady.restartStatus).toBe('pending');
    expect(duplicateReady.restart).toBe(firstRestart);
  });
});
