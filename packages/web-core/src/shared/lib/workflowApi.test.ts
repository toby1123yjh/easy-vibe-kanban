import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workflowApi, WorkflowRevisionConflictError } from './workflowApi';

const { makeLocalApiRequest } = vi.hoisted(() => ({
  makeLocalApiRequest: vi.fn(),
}));

vi.mock('@/shared/lib/localApiTransport', () => ({
  makeLocalApiRequest,
}));

describe('workflow API revision conflicts', () => {
  beforeEach(() => {
    makeLocalApiRequest.mockReset();
  });

  it('preserves typed 409 conflict data for editor recovery', async () => {
    makeLocalApiRequest.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          message: 'workflow revision changed',
          error_data: {
            workflow_id: 'workflow-1',
            expected_revision: 4,
            current_revision: 5,
          },
        }),
        {
          status: 409,
          statusText: 'Conflict',
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const result = workflowApi.update('workflow-1', {
      expected_revision: 4,
      name: 'Local edit',
      description: null,
      graph_json: null,
    });

    await expect(result).rejects.toEqual(
      expect.objectContaining({
        name: 'WorkflowRevisionConflictError',
        conflict: {
          workflow_id: 'workflow-1',
          expected_revision: 4,
          current_revision: 5,
        },
      }) satisfies Partial<WorkflowRevisionConflictError>
    );
  });
});
