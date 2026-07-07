import { makeLocalApiRequest } from '@/shared/lib/localApiTransport';
import type {
  ListScheduledTasksQuery,
  ScheduledTaskListResponse,
  ScheduledTaskResponse,
  ScheduledTaskRunNowResponse,
  UpdateScheduledTaskRequest,
  UpsertScheduledTaskRequest,
} from 'shared/types';

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
  if (init.body && !headers.has('Content-Type')) {
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

async function getJson<T>(
  response: Response,
  errorMessage: string
): Promise<T> {
  if (!response.ok) {
    throw await parseError(response, errorMessage);
  }
  return response.json();
}

async function mutate<T>(response: Response, errorMessage: string): Promise<T> {
  if (!response.ok) {
    throw await parseError(response, errorMessage);
  }
  const wrapped: MutationResponse<T> = await response.json();
  return wrapped.data;
}

function buildScheduledTaskQuery(query?: ListScheduledTasksQuery): string {
  if (!query) return '';

  const params = new URLSearchParams();
  if (query.target_type) {
    params.set('target_type', query.target_type);
  }
  if (query.target_id) {
    params.set('target_id', query.target_id);
  }

  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export const scheduledTaskApi = {
  async list(
    projectId: string,
    query?: ListScheduledTasksQuery
  ): Promise<ScheduledTaskListResponse> {
    return getJson(
      await localFetch(
        `/projects/${projectId}/scheduled-tasks${buildScheduledTaskQuery(
          query
        )}`
      ),
      'Failed to list scheduled tasks'
    );
  },

  async get(taskId: string): Promise<ScheduledTaskResponse> {
    return getJson(
      await localFetch(`/scheduled-tasks/${taskId}`),
      'Failed to get scheduled task'
    );
  },

  async upsert(
    projectId: string,
    payload: UpsertScheduledTaskRequest
  ): Promise<ScheduledTaskResponse> {
    return mutate(
      await localFetch(`/projects/${projectId}/scheduled-tasks`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      'Failed to save scheduled task'
    );
  },

  async update(
    taskId: string,
    payload: UpdateScheduledTaskRequest
  ): Promise<ScheduledTaskResponse> {
    return mutate(
      await localFetch(`/scheduled-tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
      'Failed to update scheduled task'
    );
  },

  async delete(taskId: string): Promise<void> {
    const response = await localFetch(`/scheduled-tasks/${taskId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw await parseError(response, 'Failed to delete scheduled task');
    }
    await response.json();
  },

  async runNow(taskId: string): Promise<ScheduledTaskRunNowResponse> {
    return mutate(
      await localFetch(`/scheduled-tasks/${taskId}/run-now`, {
        method: 'POST',
      }),
      'Failed to run scheduled task'
    );
  },
};
