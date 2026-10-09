import type {
  ExecutionDataCapabilities,
  SessionDeletionResult,
  ProjectCursor,
  ProjectPage,
  SessionCursor,
  SessionPage,
  ExecutionCursor,
  ExecutionSummary,
  ExecutionSummaryPage,
} from 'shared/types';
import { handleApiResponse } from './api';
import {
  createDiscoveryRequestOptions,
  type DiscoveryRequestOptions,
} from './executionDataDiscovery';
import { makeLocalApiRequest } from './localApiTransport';

interface CursorPageOptions<TCursor> {
  cursor?: TCursor | null;
  limit?: number;
}

export type ProjectPageOptions = CursorPageOptions<ProjectCursor> &
  DiscoveryRequestOptions;

export interface SessionPageOptions
  extends CursorPageOptions<SessionCursor>,
    DiscoveryRequestOptions {
  projectId?: string;
}

export interface ExecutionPageOptions
  extends CursorPageOptions<ExecutionCursor>,
    DiscoveryRequestOptions {
  projectId: string;
  taskId?: string;
}

export type ExecutionChildrenPageOptions = CursorPageOptions<ExecutionCursor>;

type StableCursor = ProjectCursor | SessionCursor | ExecutionCursor;

function appendCursor(params: URLSearchParams, cursor?: StableCursor | null) {
  if (!cursor) return;
  params.set('cursor_updated_at', cursor.updated_at);
  params.set('cursor_id', cursor.id);
}

function appendLimit(params: URLSearchParams, limit?: number) {
  if (limit !== undefined) {
    params.set('limit', String(limit));
  }
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

async function get<T>(
  path: string,
  options?: DiscoveryRequestOptions
): Promise<T> {
  // Discovery callers bind Host identity explicitly. Other API methods retain
  // the default `current` Host behavior until their owners migrate.
  const requestOptions = options
    ? createDiscoveryRequestOptions(options)
    : undefined;
  return handleApiResponse<T>(await makeLocalApiRequest(path, requestOptions));
}

export const executionDataApi = {
  defaultProjectDirectory(
    hostId: string | null
  ): Promise<{ directory_path: string | null }> {
    return get('/api/projects/default-directory', { hostId });
  },

  capabilities(): Promise<ExecutionDataCapabilities> {
    return get('/api/execution-data/capabilities');
  },

  listProjects(options: ProjectPageOptions = {}): Promise<ProjectPage> {
    const params = new URLSearchParams();
    appendCursor(params, options.cursor);
    appendLimit(params, options.limit);
    return get(withQuery('/api/projects', params), options);
  },

  listRecentSessions(options: SessionPageOptions = {}): Promise<SessionPage> {
    const params = new URLSearchParams();
    if (options.projectId) params.set('project_id', options.projectId);
    appendCursor(params, options.cursor);
    appendLimit(params, options.limit);
    return get(withQuery('/api/sessions/recent', params), options);
  },

  listExecutions(options: ExecutionPageOptions): Promise<ExecutionSummaryPage> {
    const params = new URLSearchParams();
    params.set('project_id', options.projectId);
    if (options.taskId) params.set('task_id', options.taskId);
    appendCursor(params, options.cursor);
    appendLimit(params, options.limit);
    return get(withQuery('/api/executions', params), options);
  },

  async deleteExecution(
    executionId: string,
    sessionId: string,
    hostId: string | null,
    stopRunning = false,
    deleteManagedFiles = false
  ): Promise<SessionDeletionResult> {
    const params = new URLSearchParams({ session_id: sessionId });
    if (stopRunning) params.set('stop_running', 'true');
    if (deleteManagedFiles) params.set('delete_managed_files', 'true');
    return handleApiResponse<SessionDeletionResult>(
      await makeLocalApiRequest(
        withQuery(`/api/executions/${encodeURIComponent(executionId)}`, params),
        { ...createDiscoveryRequestOptions({ hostId }), method: 'DELETE' }
      )
    );
  },

  getExecution(executionId: string): Promise<ExecutionSummary> {
    return get(`/api/executions/${encodeURIComponent(executionId)}`);
  },

  listExecutionChildren(
    executionId: string,
    options: ExecutionChildrenPageOptions = {}
  ): Promise<ExecutionSummaryPage> {
    const params = new URLSearchParams();
    appendCursor(params, options.cursor);
    appendLimit(params, options.limit);
    return get(
      withQuery(
        `/api/executions/${encodeURIComponent(executionId)}/children`,
        params
      )
    );
  },
};
