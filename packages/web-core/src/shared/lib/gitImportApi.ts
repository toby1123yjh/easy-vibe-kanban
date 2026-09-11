import type {
  GitConnection,
  WriteGitConnection,
  GitRemoteInspection,
  GitImportJob,
  StartGitImport,
} from 'shared/types';
import { handleApiResponse } from './api';
import { makeLocalApiRequest } from './localApiTransport';

async function request<T>(
  hostId: string | null,
  path: string,
  method = 'GET',
  body?: unknown
): Promise<T> {
  return handleApiResponse<T>(
    await makeLocalApiRequest(path, {
      hostScope: 'explicit',
      hostId,
      method,
      headers:
        body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
}

export const gitImportApi = {
  connections: (hostId: string | null) =>
    request<GitConnection[]>(hostId, '/api/git-connections'),
  saveConnection: (
    hostId: string | null,
    data: WriteGitConnection,
    id?: string
  ) =>
    request<GitConnection>(
      hostId,
      `/api/git-connections${id ? `/${encodeURIComponent(id)}` : ''}`,
      id ? 'PUT' : 'POST',
      data
    ),
  deleteConnection: (hostId: string | null, id: string) =>
    request<void>(
      hostId,
      `/api/git-connections/${encodeURIComponent(id)}`,
      'DELETE'
    ),
  testConnection: (hostId: string | null, id: string, url: string) =>
    request<GitRemoteInspection>(
      hostId,
      `/api/git-connections/${encodeURIComponent(id)}/test`,
      'POST',
      { url }
    ),
  inspect: (hostId: string | null, url: string, connectionId: string | null) =>
    request<GitRemoteInspection>(hostId, '/api/git-imports/inspect', 'POST', {
      url,
      connection_id: connectionId,
    }),
  start: (hostId: string | null, data: StartGitImport) =>
    request<GitImportJob>(hostId, '/api/git-imports', 'POST', data),
  get: (hostId: string | null, id: string) =>
    request<GitImportJob>(hostId, `/api/git-imports/${encodeURIComponent(id)}`),
  cancel: (hostId: string | null, id: string) =>
    request<GitImportJob>(
      hostId,
      `/api/git-imports/${encodeURIComponent(id)}/cancel`,
      'POST'
    ),
};
