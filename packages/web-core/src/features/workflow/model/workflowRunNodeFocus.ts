export type WorkflowRunNodePanel = 'conversation' | 'details';

export interface WorkflowRunNodeFocus {
  nodeId: string;
  panel?: WorkflowRunNodePanel;
}

interface WorkflowRunNodeFocusStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY_PREFIX = 'vibe.workflowRun.nodeFocus.';

function getStorage(): WorkflowRunNodeFocusStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getStorageKey(runId: string): string {
  return `${STORAGE_KEY_PREFIX}${runId}`;
}

export function queueWorkflowRunNodeFocus(
  runId: string,
  focus: WorkflowRunNodeFocus,
  storage: WorkflowRunNodeFocusStorage | null = getStorage()
): void {
  if (!storage || !runId || !focus.nodeId) return;

  try {
    storage.setItem(getStorageKey(runId), JSON.stringify(focus));
  } catch {
    // Ignore storage failures; navigation still works without node focus.
  }
}

export function consumeWorkflowRunNodeFocus(
  runId: string,
  storage: WorkflowRunNodeFocusStorage | null = getStorage()
): WorkflowRunNodeFocus | null {
  if (!storage || !runId) return null;

  const key = getStorageKey(runId);
  try {
    const value = storage.getItem(key);
    storage.removeItem(key);
    if (!value) return null;

    const parsed = JSON.parse(value) as WorkflowRunNodeFocus;
    if (!parsed || typeof parsed.nodeId !== 'string' || !parsed.nodeId) {
      return null;
    }

    return {
      nodeId: parsed.nodeId,
      panel: parsed.panel === 'conversation' ? 'conversation' : 'details',
    };
  } catch {
    storage.removeItem(key);
    return null;
  }
}
