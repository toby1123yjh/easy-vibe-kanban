import { create } from 'zustand';

interface TaskSelectionState {
  /** Set of currently selected issue IDs */
  selectedTaskIds: Set<string>;
  /** Anchor issue for Shift+Click range selection */
  anchorTaskId: string | null;
  /** Cursor position for keyboard-driven selection (Shift+J/K) */
  cursorTaskId: string | null;
  /** Flat ordered list of all visible issue IDs (set by the kanban container) */
  orderedTaskIds: string[];

  toggleTask: (taskId: string) => void;
  selectRange: (targetTaskId: string) => void;
  /** Extend selection by one issue in the given direction (for Shift+J/K) */
  selectAdjacent: (
    direction: 'up' | 'down',
    fallbackTaskId?: string | null
  ) => void;
  selectAll: () => void;
  clearSelection: () => void;
  /** Set anchor for range selection without selecting the issue */
  setAnchor: (taskId: string) => void;
  setOrderedTaskIds: (ids: string[]) => void;
}

export const useTaskSelectionStore = create<TaskSelectionState>((set, get) => ({
  selectedTaskIds: new Set<string>(),
  anchorTaskId: null,
  cursorTaskId: null,
  orderedTaskIds: [],

  toggleTask: (taskId: string) => {
    const { selectedTaskIds, anchorTaskId } = get();
    const next = new Set(selectedTaskIds);
    const isDeselecting = next.has(taskId);
    if (isDeselecting) {
      next.delete(taskId);
    } else {
      // When starting multi-select from an opened issue, include the
      // anchor (the opened issue) so both end up selected.
      if (next.size === 0 && anchorTaskId && anchorTaskId !== taskId) {
        next.add(anchorTaskId);
      }
      next.add(taskId);
    }
    // Only move anchor/cursor when selecting, not when deselecting
    set({
      selectedTaskIds: next,
      ...(isDeselecting ? {} : { anchorTaskId: taskId, cursorTaskId: taskId }),
    });
  },

  selectRange: (targetTaskId: string) => {
    const { anchorTaskId, orderedTaskIds } = get();
    if (!anchorTaskId) {
      // No anchor — just select the target
      set({
        selectedTaskIds: new Set([targetTaskId]),
        anchorTaskId: targetTaskId,
        cursorTaskId: targetTaskId,
      });
      return;
    }

    const anchorIndex = orderedTaskIds.indexOf(anchorTaskId);
    const targetIndex = orderedTaskIds.indexOf(targetTaskId);

    if (anchorIndex === -1 || targetIndex === -1) {
      // Fallback if IDs not in the ordered list
      set({
        selectedTaskIds: new Set([targetTaskId]),
        anchorTaskId: targetTaskId,
        cursorTaskId: targetTaskId,
      });
      return;
    }

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);
    const rangeIds = orderedTaskIds.slice(start, end + 1);

    // Replace selection with the new range (standard platform behavior)
    set({
      selectedTaskIds: new Set(rangeIds),
      cursorTaskId: targetTaskId,
    });
  },

  selectAdjacent: (
    direction: 'up' | 'down',
    fallbackTaskId?: string | null
  ) => {
    const { anchorTaskId, cursorTaskId, orderedTaskIds, selectedTaskIds } =
      get();
    if (orderedTaskIds.length === 0) return;

    // Determine starting point: cursor > anchor > fallback (open issue) > first
    const startId = cursorTaskId ?? anchorTaskId ?? fallbackTaskId ?? null;
    const startIndex = startId ? orderedTaskIds.indexOf(startId) : -1;

    if (startIndex === -1 && selectedTaskIds.size === 0) {
      // No starting point — select the first or last issue to begin
      const id =
        direction === 'down'
          ? orderedTaskIds[0]
          : orderedTaskIds[orderedTaskIds.length - 1];
      set({
        selectedTaskIds: new Set([id]),
        anchorTaskId: id,
        cursorTaskId: id,
      });
      return;
    }

    const effectiveIndex = startIndex === -1 ? 0 : startIndex;
    const nextIndex =
      direction === 'down' ? effectiveIndex + 1 : effectiveIndex - 1;

    // Clamp to bounds
    if (nextIndex < 0 || nextIndex >= orderedTaskIds.length) return;

    const nextId = orderedTaskIds[nextIndex];

    // Set anchor if none exists
    const effectiveAnchor = anchorTaskId ?? orderedTaskIds[effectiveIndex];

    // Build range from anchor to new cursor
    const anchorIndex = orderedTaskIds.indexOf(effectiveAnchor);
    const rangeStart = Math.min(anchorIndex, nextIndex);
    const rangeEnd = Math.max(anchorIndex, nextIndex);
    const rangeIds = orderedTaskIds.slice(rangeStart, rangeEnd + 1);

    set({
      selectedTaskIds: new Set(rangeIds),
      anchorTaskId: effectiveAnchor,
      cursorTaskId: nextId,
    });
  },

  selectAll: () => {
    const { orderedTaskIds } = get();
    set({ selectedTaskIds: new Set(orderedTaskIds) });
  },

  clearSelection: () => {
    set({
      selectedTaskIds: new Set<string>(),
      anchorTaskId: null,
      cursorTaskId: null,
    });
  },

  setAnchor: (taskId: string) => {
    set({ anchorTaskId: taskId, cursorTaskId: taskId });
  },

  setOrderedTaskIds: (ids: string[]) => {
    set({ orderedTaskIds: ids });
  },
}));
