import { makeLocalApiRequest } from '@/shared/lib/localApiTransport';
import type {
  WorkflowTemplateListResponse,
  WorkflowTemplateResponse,
  CreateWorkflowRequest,
  UpdateWorkflowRequest,
  TriggerWorkflowRequest,
  CreateWorkflowAttemptRequest,
  RunWorkflowAttemptRequest,
  WorkflowAttemptListResponse,
  WorkflowAttemptResponse,
  WorkflowRunResponse,
  WorkflowActionResponse,
} from 'shared/types';

const LOCAL_BASE = '/api/local/v1';

interface MutationResponse<T> {
  data: T;
  txid: number;
}

export type WorkflowEventKind =
  | 'run_status'
  | 'node_status'
  | 'node_output'
  | 'node_error'
  | 'node_waiting_human'
  | 'node_waiting_arena';

export interface WorkflowRuntimeEvent {
  sequence: number;
  run_id: string;
  node_id: string | null;
  kind: WorkflowEventKind;
  status: string | null;
  payload: unknown;
}

export function parseWorkflowEvent(
  event: MessageEvent
): WorkflowRuntimeEvent | null {
  try {
    const data = JSON.parse(event.data);
    if (data && typeof data === 'object' && 'kind' in data) {
      return data as WorkflowRuntimeEvent;
    }
  } catch {
    // Ignore parse errors
  }
  return null;
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

export interface ApproveNodeRequest {
  message?: string;
}

export interface RejectNodeRequest {
  message?: string;
}

export interface SelectArenaWinnerRequest {
  workspace_id: string;
}

export const workflowApi = {
  async list(projectId: string): Promise<WorkflowTemplateListResponse> {
    return getJson(
      await localFetch(`/projects/${projectId}/workflows`),
      'Failed to list workflows'
    );
  },

  async create(
    projectId: string,
    payload: CreateWorkflowRequest
  ): Promise<WorkflowTemplateResponse> {
    return mutate(
      await localFetch(`/projects/${projectId}/workflows`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      'Failed to create workflow'
    );
  },

  async get(workflowId: string): Promise<WorkflowTemplateResponse> {
    return getJson(
      await localFetch(`/workflows/${workflowId}`),
      'Failed to get workflow'
    );
  },

  async update(
    workflowId: string,
    payload: UpdateWorkflowRequest
  ): Promise<WorkflowTemplateResponse> {
    return mutate(
      await localFetch(`/workflows/${workflowId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      }),
      'Failed to update workflow'
    );
  },

  async delete(workflowId: string): Promise<void> {
    const response = await localFetch(`/workflows/${workflowId}`, {
      method: 'DELETE',
    });
    if (!response.ok) {
      throw await parseError(response, 'Failed to delete workflow');
    }
    // Consume DeleteResponse payload
    await response.json();
  },

  async trigger(
    workflowId: string,
    payload: TriggerWorkflowRequest
  ): Promise<WorkflowRunResponse> {
    return mutate(
      await localFetch(`/workflows/${workflowId}/trigger`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      'Failed to trigger workflow'
    );
  },

  async listAttempts(
    projectId: string,
    issueId: string
  ): Promise<WorkflowAttemptListResponse> {
    return getJson(
      await localFetch(
        `/projects/${projectId}/issues/${issueId}/workflow-attempts`
      ),
      'Failed to list workflow attempts'
    );
  },

  async createAttempt(
    projectId: string,
    issueId: string,
    payload: CreateWorkflowAttemptRequest
  ): Promise<WorkflowAttemptResponse> {
    return mutate(
      await localFetch(
        `/projects/${projectId}/issues/${issueId}/workflow-attempts`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      ),
      'Failed to create workflow attempt'
    );
  },

  async getAttempt(attemptId: string): Promise<WorkflowAttemptResponse> {
    return getJson(
      await localFetch(`/workflow-attempts/${attemptId}`),
      'Failed to get workflow attempt'
    );
  },

  async runAttempt(
    attemptId: string,
    payload: RunWorkflowAttemptRequest
  ): Promise<WorkflowRunResponse> {
    return mutate(
      await localFetch(`/workflow-attempts/${attemptId}/run`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      'Failed to run workflow attempt'
    );
  },

  async getRun(runId: string): Promise<WorkflowRunResponse> {
    return getJson(
      await localFetch(`/workflow-runs/${runId}`),
      'Failed to get workflow run'
    );
  },

  async cancelRun(runId: string): Promise<WorkflowActionResponse> {
    return mutate(
      await localFetch(`/workflow-runs/${runId}/cancel`, {
        method: 'POST',
      }),
      'Failed to cancel workflow run'
    );
  },

  async approve(
    runId: string,
    nodeId: string,
    payload: ApproveNodeRequest
  ): Promise<WorkflowActionResponse> {
    return mutate(
      await localFetch(`/workflow-runs/${runId}/nodes/${nodeId}/approve`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      'Failed to approve node'
    );
  },

  async reject(
    runId: string,
    nodeId: string,
    payload: RejectNodeRequest
  ): Promise<WorkflowActionResponse> {
    return mutate(
      await localFetch(`/workflow-runs/${runId}/nodes/${nodeId}/reject`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      'Failed to reject node'
    );
  },

  async retry(runId: string, nodeId: string): Promise<WorkflowActionResponse> {
    return mutate(
      await localFetch(`/workflow-runs/${runId}/nodes/${nodeId}/retry`, {
        method: 'POST',
      }),
      'Failed to retry node'
    );
  },

  async selectArenaWinner(
    runId: string,
    nodeId: string,
    payload: SelectArenaWinnerRequest
  ): Promise<WorkflowActionResponse> {
    return mutate(
      await localFetch(`/workflow-runs/${runId}/nodes/${nodeId}/arena-winner`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
      'Failed to select arena winner'
    );
  },

  eventsUrl(runId: string): string {
    return `${LOCAL_BASE}/workflow-runs/${runId}/events`;
  },
};
