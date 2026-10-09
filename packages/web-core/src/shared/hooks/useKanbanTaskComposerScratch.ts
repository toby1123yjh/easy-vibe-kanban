import { useEffect, useRef } from 'react';
import { useAppRuntime } from '@/shared/hooks/useAppRuntime';
import {
  useKanbanTaskComposerStore,
  type KanbanTaskComposerEntry,
} from '@/shared/stores/useKanbanTaskComposerStore';

const STORAGE_KEY = 'vk-kanban-task-composer';

function readStoredComposerState(): Record<
  string,
  KanbanTaskComposerEntry | undefined
> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Record<string, KanbanTaskComposerEntry | undefined>;
  } catch {
    return null;
  }
}

function writeStoredComposerState(
  byKey: Record<string, KanbanTaskComposerEntry | undefined>
): void {
  try {
    const filtered: Record<string, KanbanTaskComposerEntry> = {};
    for (const [key, entry] of Object.entries(byKey)) {
      if (entry) filtered[key] = entry;
    }

    if (Object.keys(filtered).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    }
  } catch {
    // Quota exceeded or unavailable
  }
}

/**
 * Syncs KanbanIssueComposerStore to localStorage on remote-web.
 * No-op on local runtime. Call once at the app root level.
 *
 * Hydration happens synchronously on first call (before any effects)
 * to avoid race conditions with React StrictMode double-mounting.
 */
export function useKanbanTaskComposerScratch() {
  const runtime = useAppRuntime();
  const isRemote = runtime === 'remote';
  const isApplyingRef = useRef(false);
  const hasHydratedRef = useRef(false);
  const prevByKeyRef = useRef(useKanbanTaskComposerStore.getState().byKey);

  // Hydrate synchronously during render (not in an effect) to ensure
  // the store has data before any child components mount.
  // This avoids StrictMode double-mount issues where effects run,
  // clean up, then run again — but refs persist across that cycle.
  if (isRemote && !hasHydratedRef.current) {
    hasHydratedRef.current = true;
    const stored = readStoredComposerState();
    if (stored && Object.keys(stored).length > 0) {
      const current = useKanbanTaskComposerStore.getState().byKey;
      const merged = { ...stored, ...current };
      isApplyingRef.current = true;
      useKanbanTaskComposerStore.setState({ byKey: merged });
      isApplyingRef.current = false;
      prevByKeyRef.current = merged;
    }
  }

  useEffect(() => {
    if (!isRemote) return;

    const unsubscribe = useKanbanTaskComposerStore.subscribe((state) => {
      if (isApplyingRef.current) return;
      if (prevByKeyRef.current === state.byKey) return;
      prevByKeyRef.current = state.byKey;
      writeStoredComposerState(state.byKey);
    });

    return unsubscribe;
  }, [isRemote]);
}
