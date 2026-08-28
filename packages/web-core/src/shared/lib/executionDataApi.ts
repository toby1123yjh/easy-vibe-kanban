import type {
  ExecutionDataCapabilities,
  ProjectCursor,
  ProjectPage,
  SessionCursor,
  SessionPage,
  TaskCursor,
  TaskSummary,
  TaskSummaryPage,
} from 'shared/types';
import { handleApiResponse } from './api';
import { makeLocalApiRequest } from './localApiTransport';

interface CursorPageOptions<TCursor> {
  cursor?: TCursor | null;
  limit?: number;
}

export type ProjectPageOptions = CursorPageOptions<ProjectCursor>;

export interface SessionPageOptions extends CursorPageOptions<SessionCursor> {
  projectId?: string;
}

export interface TaskPageOptions extends CursorPageOptions<TaskCursor> {
  projectId: string;
  issueId?: string;
}

export type TaskChildrenPageOptions = CursorPageOptions<TaskCursor>;

type StableCursor = ProjectCursor | SessionCursor | TaskCursor;

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

async function get<T>(path: string): Promise<T> {
  // Keep the default `current` Host scope. Local routes can proxy to a
  // selected Host, while Remote's installed transport relays the same path
  // and fails closed when it has no Host context.
  return handleApiResponse<T>(await makeLocalApiRequest(path));
}

export const executionDataApi = {
  capabilities(): Promise<ExecutionDataCapabilities> {
    return get('/api/execution-data/capabilities');
  },

  listProjects(options: ProjectPageOptions = {}): Promise<ProjectPage> {
    const params = new URLSearchParams();
    appendCursor(params, options.cursor);
    appendLimit(params, options.limit);
    return get(withQuery('/api/projects', params));
  },

  listRecentSessions(options: SessionPageOptions = {}): Promise<SessionPage> {
    const params = new URLSearchParams();
    if (options.projectId) params.set('project_id', options.projectId);
    appendCursor(params, options.cursor);
    appendLimit(params, options.limit);
    return get(withQuery('/api/sessions/recent', params));
  },

  listTasks(options: TaskPageOptions): Promise<TaskSummaryPage> {
    const params = new URLSearchParams();
    params.set('project_id', options.projectId);
    if (options.issueId) params.set('issue_id', options.issueId);
    appendCursor(params, options.cursor);
    appendLimit(params, options.limit);
    return get(withQuery('/api/tasks', params));
  },

  getTask(taskId: string): Promise<TaskSummary> {
    return get(`/api/tasks/${encodeURIComponent(taskId)}`);
  },

  listTaskChildren(
    taskId: string,
    options: TaskChildrenPageOptions = {}
  ): Promise<TaskSummaryPage> {
    const params = new URLSearchParams();
    appendCursor(params, options.cursor);
    appendLimit(params, options.limit);
    return get(
      withQuery(`/api/tasks/${encodeURIComponent(taskId)}/children`, params)
    );
  },
};
