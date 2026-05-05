// Arena (race mode) API client.
//
// Backed by `crates/server/src/routes/local_remote.rs` — these endpoints
// are local-only (no remote/cloud equivalent), so we always go through
// `makeLocalApiRequest` directly rather than through the
// `remoteApi.ts::makeRequest` abstraction (which would forward to the
// cloud backend when one is configured).
//
// The TS type definitions below mirror the structs declared in
// `crates/db/src/models/arena_group.rs` and
// `crates/server/src/routes/local_remote.rs`. They are intentionally
// duplicated here (rather than imported from `shared/types`) until the
// next `pnpm run generate-types` run regenerates the canonical
// declarations. Once regenerated, callers can keep importing from this
// module — we just swap the local definitions for re-exports of the
// generated types.

import type { ExecutorConfig, Workspace } from 'shared/types';
import { makeLocalApiRequest } from '@/shared/lib/localApiTransport';

// ── Mirror of Rust types (see comment above) ────────────────────────

export type ArenaStatus = 'active' | 'promoted' | 'archived';

export interface ArenaGroup {
  id: string;
  issue_id: string;
  project_id: string;
  prompt: string;
  base_branch: string;
  promoted_workspace_id: string | null;
  promoted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArenaWorkspaceSummary {
  workspace_id: string;
  name: string | null;
  branch: string;
  arena_status: ArenaStatus;
  executor: string | null;
  variant: string | null;
}

export interface ArenaGroupResponse extends ArenaGroup {
  workspaces: ArenaWorkspaceSummary[];
}

export interface ArenaAttemptInput {
  executor_config: ExecutorConfig;
  name?: string | null;
  prompt?: string | null;
}

export interface WorkspaceRepoInput {
  repo_id: string;
  target_branch: string;
}

export interface CreateArenaRequest {
  project_id: string;
  base_branch: string;
  prompt: string;
  repos: WorkspaceRepoInput[];
  attempts: ArenaAttemptInput[];
}

export interface PromoteArenaRequest {
  workspace_id: string;
}

export interface RetryArenaRequest {
  executor_config: ExecutorConfig;
  name?: string | null;
  prompt?: string | null;
}

export interface DissolveArenaResponse {
  group_id: string;
  workspaces_archived: number;
}

// ── Transport ───────────────────────────────────────────────────────

const LOCAL_BASE = '/api/local/v1';

interface MutationResponse<T> {
  data: T;
  txid: number;
}

async function localFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return makeLocalApiRequest(`${LOCAL_BASE}${path}`, {
    ...init,
    headers,
    hostScope: 'none',
  });
}

async function parseError(
  response: Response,
  fallback: string
): Promise<Error> {
  try {
    const body = await response.json();
    const message = body?.message || body?.error || fallback;
    return new Error(`${message} (${response.status} ${response.statusText})`);
  } catch {
    return new Error(`${fallback} (${response.status} ${response.statusText})`);
  }
}

async function getJson<T>(path: string, fallback: string): Promise<T> {
  const response = await localFetch(path, { method: 'GET' });
  if (!response.ok) {
    throw await parseError(response, fallback);
  }
  return response.json() as Promise<T>;
}

async function mutate<T>(
  path: string,
  init: RequestInit,
  fallback: string
): Promise<T> {
  const response = await localFetch(path, init);
  if (!response.ok) {
    throw await parseError(response, fallback);
  }
  const body = (await response.json()) as MutationResponse<T>;
  return body.data;
}

// ── Public API ──────────────────────────────────────────────────────

export const arenaApi = {
  /** POST /v1/issues/{issue_id}/arena */
  create: (
    issueId: string,
    payload: CreateArenaRequest
  ): Promise<ArenaGroupResponse> =>
    mutate<ArenaGroupResponse>(
      `/issues/${issueId}/arena`,
      { method: 'POST', body: JSON.stringify(payload) },
      'Failed to create arena group'
    ),

  /** GET /v1/issues/{issue_id}/arena/active */
  getActiveForIssue: (issueId: string): Promise<ArenaGroupResponse | null> =>
    getJson<ArenaGroupResponse | null>(
      `/issues/${issueId}/arena/active`,
      'Failed to load active arena group'
    ),

  /** GET /v1/arena/{group_id} */
  get: (groupId: string): Promise<ArenaGroupResponse> =>
    getJson<ArenaGroupResponse>(
      `/arena/${groupId}`,
      'Failed to load arena group'
    ),

  /** POST /v1/arena/{group_id}/promote */
  promote: (
    groupId: string,
    payload: PromoteArenaRequest
  ): Promise<ArenaGroupResponse> =>
    mutate<ArenaGroupResponse>(
      `/arena/${groupId}/promote`,
      { method: 'POST', body: JSON.stringify(payload) },
      'Failed to promote arena workspace'
    ),

  /** POST /v1/arena/{group_id}/workspaces/{workspace_id}/retry */
  retry: (
    groupId: string,
    workspaceId: string,
    payload: RetryArenaRequest
  ): Promise<ArenaGroupResponse> =>
    mutate<ArenaGroupResponse>(
      `/arena/${groupId}/workspaces/${workspaceId}/retry`,
      { method: 'POST', body: JSON.stringify(payload) },
      'Failed to retry arena workspace'
    ),

  /** DELETE /v1/arena/{group_id} */
  dissolve: (groupId: string): Promise<DissolveArenaResponse> =>
    mutate<DissolveArenaResponse>(
      `/arena/${groupId}`,
      { method: 'DELETE' },
      'Failed to dissolve arena group'
    ),

  /** GET /v1/issues/{issue_id}/workspaces */
  listIssueWorkspaces: (issueId: string): Promise<Workspace[]> =>
    getJson<Workspace[]>(
      `/issues/${issueId}/workspaces`,
      'Failed to list issue workspaces'
    ),
};
