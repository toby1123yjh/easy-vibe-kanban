import type { GitRemoteInspection } from 'shared/types';
import type { gitImportApi } from './gitImportApi';

export type GitImportRecovery = {
  request: Parameters<typeof gitImportApi.start>[1];
  inspection: GitRemoteInspection;
  jobId: string | null;
};

const key = (hostId: string | null, scope: string) =>
  `git-import:${JSON.stringify([hostId, scope])}`;

// Only inspected URL metadata and operation IDs: never SSH key/passphrase drafts.
export function readGitImportRecovery(
  hostId: string | null,
  scope: string
): GitImportRecovery | null {
  const raw = localStorage.getItem(key(hostId, scope));
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (
    !value ||
    typeof value !== 'object' ||
    !('request' in value) ||
    !('inspection' in value) ||
    !('jobId' in value)
  )
    throw new Error('Invalid saved Git import');
  const { request, inspection, jobId } = value;
  if (
    !request ||
    typeof request !== 'object' ||
    !inspection ||
    typeof inspection !== 'object'
  )
    throw new Error('Invalid saved Git import');
  const nullableString = (v: unknown) => v === null || typeof v === 'string';
  if (
    !('request_id' in request) ||
    typeof request.request_id !== 'string' ||
    !('url' in request) ||
    typeof request.url !== 'string' ||
    !('connection_id' in request) ||
    !nullableString(request.connection_id) ||
    !('branch' in request) ||
    !nullableString(request.branch) ||
    !('directory_path' in request) ||
    !nullableString(request.directory_path) ||
    !nullableString(jobId) ||
    !('url' in inspection) ||
    inspection.url !== request.url ||
    !('branches' in inspection) ||
    !Array.isArray(inspection.branches) ||
    !inspection.branches.every((v) => typeof v === 'string') ||
    !('default_branch' in inspection) ||
    !nullableString(inspection.default_branch) ||
    !('suggested_directory' in inspection) ||
    typeof inspection.suggested_directory !== 'string'
  )
    throw new Error('Invalid saved Git import');
  return value as GitImportRecovery;
}

export function writeGitImportRecovery(
  hostId: string | null,
  scope: string,
  value: GitImportRecovery
) {
  localStorage.setItem(key(hostId, scope), JSON.stringify(value));
}

export function clearGitImportRecovery(
  hostId: string | null,
  scope: string,
  expectedJobId?: string
) {
  if (
    expectedJobId &&
    readGitImportRecovery(hostId, scope)?.jobId !== expectedJobId
  )
    return;
  localStorage.removeItem(key(hostId, scope));
}
