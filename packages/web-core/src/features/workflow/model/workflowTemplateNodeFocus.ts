export type WorkflowTemplateNodePanel = 'session' | 'edit';

export interface WorkflowTemplateNodeFocus {
  nodeId: string;
  panel?: WorkflowTemplateNodePanel;
}

interface WorkflowTemplateNodeFocusStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY_PREFIX = 'vibe.workflowTemplate.nodeFocus.';

function getStorage(): WorkflowTemplateNodeFocusStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function getStorageKey(workflowId: string): string {
  return `${STORAGE_KEY_PREFIX}${workflowId}`;
}

export function queueWorkflowTemplateNodeFocus(
  workflowId: string,
  focus: WorkflowTemplateNodeFocus,
  storage: WorkflowTemplateNodeFocusStorage | null = getStorage()
): void {
  if (!storage || !workflowId || !focus.nodeId) return;

  try {
    storage.setItem(getStorageKey(workflowId), JSON.stringify(focus));
  } catch {
    // Ignore storage failures; navigation still works without node focus.
  }
}

export function consumeWorkflowTemplateNodeFocus(
  workflowId: string,
  storage: WorkflowTemplateNodeFocusStorage | null = getStorage()
): WorkflowTemplateNodeFocus | null {
  if (!storage || !workflowId) return null;

  const key = getStorageKey(workflowId);
  try {
    const value = storage.getItem(key);
    storage.removeItem(key);
    if (!value) return null;

    const parsed = JSON.parse(value) as WorkflowTemplateNodeFocus;
    if (!parsed || typeof parsed.nodeId !== 'string' || !parsed.nodeId) {
      return null;
    }

    return {
      nodeId: parsed.nodeId,
      panel: parsed.panel === 'edit' ? 'edit' : 'session',
    };
  } catch {
    storage.removeItem(key);
    return null;
  }
}
