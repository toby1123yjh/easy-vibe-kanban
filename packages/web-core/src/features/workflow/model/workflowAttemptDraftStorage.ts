import type { DraftWorkspaceRepo } from 'shared/types';

const DRAFT_ID_PREFIX = 'draft-';
const STORAGE_KEY_PREFIX = 'vibe.workflowAttemptDraft.';

export interface IssueWorkflowAttemptDraft {
  id: string;
  projectId: string;
  issueId: string;
  issueTitle: string;
  issueDescription?: string | null;
  name: string;
  graphJson: string;
  repos: DraftWorkspaceRepo[];
  createdAt: string;
}

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.sessionStorage;
}

function storageKey(id: string): string {
  return `${STORAGE_KEY_PREFIX}${id}`;
}

export function createIssueWorkflowAttemptDraft(
  draft: Omit<IssueWorkflowAttemptDraft, 'id' | 'createdAt'>
): IssueWorkflowAttemptDraft {
  const id = crypto.randomUUID();
  const nextDraft: IssueWorkflowAttemptDraft = {
    ...draft,
    id,
    createdAt: new Date().toISOString(),
  };
  getStorage()?.setItem(storageKey(id), JSON.stringify(nextDraft));
  return nextDraft;
}

export function toIssueWorkflowAttemptDraftRouteId(id: string): string {
  return `${DRAFT_ID_PREFIX}${id}`;
}

export function parseIssueWorkflowAttemptDraftRouteId(
  routeId: string
): string | null {
  return routeId.startsWith(DRAFT_ID_PREFIX)
    ? routeId.slice(DRAFT_ID_PREFIX.length)
    : null;
}

export function readIssueWorkflowAttemptDraft(
  id: string
): IssueWorkflowAttemptDraft | null {
  const raw = getStorage()?.getItem(storageKey(id));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as IssueWorkflowAttemptDraft;
    return parsed?.id === id ? parsed : null;
  } catch {
    return null;
  }
}

export function saveIssueWorkflowAttemptDraft(
  draft: IssueWorkflowAttemptDraft
): void {
  getStorage()?.setItem(storageKey(draft.id), JSON.stringify(draft));
}

export function deleteIssueWorkflowAttemptDraft(id: string): void {
  getStorage()?.removeItem(storageKey(id));
}
