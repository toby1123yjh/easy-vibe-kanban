import type { DraftWorkspaceRepo } from 'shared/types';

const DRAFT_ID_PREFIX = 'draft-';
const STORAGE_KEY_PREFIX = 'vibe.workflowAttemptDraft.';

export interface TaskWorkflowAttemptDraft {
  id: string;
  projectId: string;
  taskId: string;
  taskTitle: string;
  taskDescription?: string | null;
  name: string;
  graphJson: string;
  repos: DraftWorkspaceRepo[];
  directoryPath?: string;
  createdAt: string;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
}

function storageKey(id: string): string {
  return `${STORAGE_KEY_PREFIX}${id}`;
}

export function createTaskWorkflowAttemptDraft(
  draft: Omit<TaskWorkflowAttemptDraft, 'id' | 'createdAt'>
): TaskWorkflowAttemptDraft {
  const id = crypto.randomUUID();
  const nextDraft: TaskWorkflowAttemptDraft = {
    ...draft,
    id,
    createdAt: new Date().toISOString(),
  };
  getStorage()?.setItem(storageKey(id), JSON.stringify(nextDraft));
  return nextDraft;
}

export function toTaskWorkflowAttemptDraftRouteId(id: string): string {
  return `${DRAFT_ID_PREFIX}${id}`;
}

export function parseTaskWorkflowAttemptDraftRouteId(
  routeId: string
): string | null {
  return routeId.startsWith(DRAFT_ID_PREFIX)
    ? routeId.slice(DRAFT_ID_PREFIX.length)
    : null;
}

export function readTaskWorkflowAttemptDraft(
  id: string
): TaskWorkflowAttemptDraft | null {
  const raw = getStorage()?.getItem(storageKey(id));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as TaskWorkflowAttemptDraft;
    return parsed?.id === id ? parsed : null;
  } catch {
    return null;
  }
}

export function saveTaskWorkflowAttemptDraft(
  draft: TaskWorkflowAttemptDraft
): void {
  getStorage()?.setItem(storageKey(draft.id), JSON.stringify(draft));
}

export function deleteTaskWorkflowAttemptDraft(id: string): void {
  getStorage()?.removeItem(storageKey(id));
}
