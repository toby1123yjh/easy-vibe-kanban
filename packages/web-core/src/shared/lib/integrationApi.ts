import type {
  CreatedIntegration,
  CreateIntegrationRequest,
  IntegrationProjectOption,
  IntegrationSettings,
  UpdateIntegrationRequest,
} from 'shared/types';
import { handleApiResponse } from './api';
import { makeLocalApiRequest } from './localApiTransport';

async function request<T>(
  hostId: string | null,
  path: string,
  body?: unknown
): Promise<T> {
  return handleApiResponse<T>(
    await makeLocalApiRequest(`/api/integration-settings${path}`, {
      hostScope: 'explicit',
      hostId,
      method: body === undefined ? 'GET' : 'POST',
      headers:
        body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

export const integrationApi = {
  list: (hostId: string | null) => request<IntegrationSettings[]>(hostId, ''),
  projects: (hostId: string | null) =>
    request<IntegrationProjectOption[]>(hostId, '/projects'),
  create: (hostId: string | null, input: CreateIntegrationRequest) =>
    request<CreatedIntegration>(hostId, '', input),
  update: (
    hostId: string | null,
    id: string,
    input: UpdateIntegrationRequest
  ) =>
    request<IntegrationSettings>(hostId, `/${encodeURIComponent(id)}`, input),
  setEnabled: (hostId: string | null, id: string, enabled: boolean) =>
    request<IntegrationSettings>(hostId, `/${encodeURIComponent(id)}/enabled`, {
      enabled,
    }),
};
