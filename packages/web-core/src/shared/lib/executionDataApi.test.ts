import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executionDataApi } from './executionDataApi';

const { makeLocalApiRequest } = vi.hoisted(() => ({
  makeLocalApiRequest: vi.fn(),
}));

vi.mock('@/shared/lib/localApiTransport', () => ({
  makeLocalApiRequest,
}));

function success(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('execution data API', () => {
  beforeEach(() => {
    makeLocalApiRequest.mockReset();
    makeLocalApiRequest.mockResolvedValue(
      success({ executions: [], next_cursor: null })
    );
  });

  it('uses the canonical Execution route with a complete stable cursor', async () => {
    await executionDataApi.listExecutions({
      projectId: 'project-1',
      taskId: 'issue-1',
      cursor: {
        updated_at: '2026-08-29T12:34:56.789Z',
        id: 'task-1',
      },
      limit: 25,
    });

    expect(makeLocalApiRequest).toHaveBeenCalledOnce();
    expect(makeLocalApiRequest).toHaveBeenCalledWith(
      '/api/executions?project_id=project-1&task_id=issue-1&cursor_updated_at=2026-08-29T12%3A34%3A56.789Z&cursor_id=task-1&limit=25'
    );
  });

  it('uses the canonical Task get and children routes', async () => {
    makeLocalApiRequest
      .mockResolvedValueOnce(success({ id: 'task/one' }))
      .mockResolvedValueOnce(success({ executions: [], next_cursor: null }));

    await executionDataApi.getExecution('task/one');
    await executionDataApi.listExecutionChildren('task/one', { limit: 10 });

    expect(makeLocalApiRequest).toHaveBeenNthCalledWith(
      1,
      '/api/executions/task%2Fone'
    );
    expect(makeLocalApiRequest).toHaveBeenNthCalledWith(
      2,
      '/api/executions/task%2Fone/children?limit=10'
    );
  });

  it('uses lightweight project, session, and capability routes', async () => {
    makeLocalApiRequest
      .mockResolvedValueOnce(success({ projects: [], next_cursor: null }))
      .mockResolvedValueOnce(success({ sessions: [], next_cursor: null }))
      .mockResolvedValueOnce(
        success({
          owner: 'local_host',
          execution_queries: true,
          execution_actions: true,
        })
      );

    await executionDataApi.listProjects({ limit: 5 });
    await executionDataApi.listRecentSessions({
      projectId: 'project-1',
      limit: 10,
    });
    await executionDataApi.capabilities();

    expect(makeLocalApiRequest).toHaveBeenNthCalledWith(
      1,
      '/api/projects?limit=5'
    );
    expect(makeLocalApiRequest).toHaveBeenNthCalledWith(
      2,
      '/api/sessions/recent?project_id=project-1&limit=10'
    );
    expect(makeLocalApiRequest).toHaveBeenNthCalledWith(
      3,
      '/api/execution-data/capabilities'
    );
  });

  it('binds discovery requests to an explicit host and abort signal', async () => {
    const signal = new AbortController().signal;

    await executionDataApi.listProjects({
      hostId: 'host-a',
      signal,
      limit: 5,
    });

    expect(makeLocalApiRequest).toHaveBeenCalledWith(
      '/api/projects?limit=5',
      expect.objectContaining({
        hostScope: 'explicit',
        hostId: 'host-a',
        relayHostId: 'host-a',
        signal,
      })
    );
  });
});
