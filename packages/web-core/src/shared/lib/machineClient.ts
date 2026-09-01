import type {
  AgentCommandInventoryView,
  AgentCommandOperationError,
  AgentCommandView,
  AgentSettingOperationError,
  AgentGarageEntry,
  AgentSettingsDiscoveryQuery,
  AgentSettingsInventory,
  AgentSettingsProfilesQuery,
  ApplyConfigProfileRequest,
  ApplyNativeFileRequest,
  ApplySettingsRequest,
  AgentToolInventoryView,
  AgentToolLocator,
  AgentToolOperationError,
  AgentToolRevealResponse,
  AgentToolView,
  CopyAgentToolRequest,
  CopyAgentToolResponse,
  CopyConfigProfileRequest,
  CopyProfilePreviewRequest,
  ConfigProfileView,
  CreateAgentToolRequest,
  CreateAgentCommandRequest,
  DeleteConfigProfileRequest,
  DuplicateConfigProfileRequest,
  Config,
  GetMcpServerResponse,
  GitBranch,
  McpServerQuery,
  NativeFilePatch,
  ProfileApplyPreviewRequest,
  ProfileCopyPreview,
  Repo,
  RevealAgentSettingRequest,
  RevealAgentSettingResponse,
  SaveConfigProfileRequest,
  UpdateConfigProfileRequest,
  SettingsDiff,
  SettingsPatch,
  SettingsSnapshot,
  UpdateMcpServersBody,
  UpdateAgentToolRequest,
  RemoveAgentToolRequest,
  RemoveAgentCommandRequest,
  ToggleAgentToolRequest,
  ToggleAgentCommandRequest,
  UpdateAgentCommandRequest,
  UpdateRepo,
  UserSystemInfo,
} from 'shared/types';
import type { AppRuntime } from '@/shared/hooks/useAppRuntime';
import { handleApiResponse } from './api';
import {
  makeLocalApiRequest,
  type LocalApiRequestOptions,
} from './localApiTransport';

export type MachineTarget =
  | {
      kind: 'local';
      id: 'local';
      apiHostId: null;
      label: string;
    }
  | {
      kind: 'remote';
      id: string;
      apiHostId: string;
      label: string;
    };

export interface MachineClient {
  target: MachineTarget;
  queryScopeKey: readonly ['machine', string];
  getConfig: () => Promise<UserSystemInfo>;
  saveConfig: (config: Config) => Promise<Config>;
  listRepos: () => Promise<Repo[]>;
  updateRepo: (repoId: string, data: UpdateRepo) => Promise<Repo>;
  deleteRepo: (repoId: string) => Promise<void>;
  registerRepo: (data: {
    path: string;
    display_name?: string;
  }) => Promise<Repo>;
  getRepoBranches: (repoId: string) => Promise<GitBranch[]>;
  loadProfiles: () => Promise<{ content: string; path: string }>;
  saveProfiles: (content: string) => Promise<string>;
  loadMcpServers: (query: McpServerQuery) => Promise<GetMcpServerResponse>;
  saveMcpServers: (
    query: McpServerQuery,
    data: UpdateMcpServersBody
  ) => Promise<void>;
  listAgentTools: (projectPath?: string) => Promise<AgentToolInventoryView>;
  listAgentCommands: (
    projectPath?: string
  ) => Promise<AgentCommandInventoryView>;
  getAgentGarage: () => Promise<AgentGarageEntry[]>;
  createAgentTool: (data: CreateAgentToolRequest) => Promise<AgentToolView>;
  updateAgentTool: (data: UpdateAgentToolRequest) => Promise<AgentToolView>;
  removeAgentTool: (data: RemoveAgentToolRequest) => Promise<void>;
  toggleAgentTool: (data: ToggleAgentToolRequest) => Promise<AgentToolView>;
  copyAgentTool: (data: CopyAgentToolRequest) => Promise<CopyAgentToolResponse>;
  revealAgentTool: (data: AgentToolLocator) => Promise<AgentToolRevealResponse>;
  createAgentCommand: (
    data: CreateAgentCommandRequest
  ) => Promise<AgentCommandView>;
  updateAgentCommand: (
    data: UpdateAgentCommandRequest
  ) => Promise<AgentCommandView>;
  removeAgentCommand: (data: RemoveAgentCommandRequest) => Promise<void>;
  toggleAgentCommand: (
    data: ToggleAgentCommandRequest
  ) => Promise<AgentCommandView>;
  discoverAgentSettings: (
    query?: Partial<AgentSettingsDiscoveryQuery>
  ) => Promise<AgentSettingsInventory>;
  diffAgentSettings: (data: SettingsPatch) => Promise<SettingsDiff>;
  applyAgentSettings: (data: ApplySettingsRequest) => Promise<SettingsSnapshot>;
  revealAgentSetting: (
    data: RevealAgentSettingRequest
  ) => Promise<RevealAgentSettingResponse>;
  diffAgentSettingsNativeFile: (data: NativeFilePatch) => Promise<SettingsDiff>;
  applyAgentSettingsNativeFile: (
    data: ApplyNativeFileRequest
  ) => Promise<SettingsSnapshot>;
  listAgentSettingsProfiles: (
    query?: Partial<AgentSettingsProfilesQuery>
  ) => Promise<ConfigProfileView[]>;
  saveAgentSettingsProfile: (
    data: SaveConfigProfileRequest
  ) => Promise<ConfigProfileView>;
  updateAgentSettingsProfile: (
    data: UpdateConfigProfileRequest
  ) => Promise<ConfigProfileView>;
  deleteAgentSettingsProfile: (
    data: DeleteConfigProfileRequest
  ) => Promise<void>;
  duplicateAgentSettingsProfile: (
    data: DuplicateConfigProfileRequest
  ) => Promise<ConfigProfileView>;
  previewAgentSettingsProfileCopy: (
    data: CopyProfilePreviewRequest
  ) => Promise<ProfileCopyPreview>;
  copyAgentSettingsProfile: (
    data: CopyConfigProfileRequest
  ) => Promise<ConfigProfileView>;
  previewAgentSettingsProfileApply: (
    data: ProfileApplyPreviewRequest
  ) => Promise<SettingsDiff>;
  applyAgentSettingsProfile: (
    data: ApplyConfigProfileRequest
  ) => Promise<SettingsSnapshot>;
}

export function formatAgentSettingOperationError(error: unknown): string {
  const detail =
    error && typeof error === 'object' && 'error_data' in error
      ? (error as { error_data?: AgentSettingOperationError }).error_data
      : undefined;
  if (detail) {
    const context = [
      detail.setting_key ? `Setting ${detail.setting_key}` : null,
      detail.file_id ? `File ${detail.file_id}` : null,
    ].filter(Boolean);
    return [
      `${detail.message} (${detail.code})`,
      context.length ? context.join(', ') : null,
      detail.recovery,
    ]
      .filter(Boolean)
      .join(' — ');
  }

  return error instanceof Error
    ? error.message
    : 'Agent settings operation failed';
}

function getMachineRequestOptions(
  runtime: AppRuntime,
  target: MachineTarget
): LocalApiRequestOptions {
  if (runtime === 'remote') {
    return {
      hostScope: 'none',
      relayHostId: target.apiHostId,
    };
  }

  if (target.apiHostId) {
    return {
      hostScope: 'explicit',
      hostId: target.apiHostId,
    };
  }

  return {
    hostScope: 'none',
  };
}

async function makeMachineRequest(
  runtime: AppRuntime,
  target: MachineTarget,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers ?? {});
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  return makeLocalApiRequest(path, {
    ...options,
    headers,
    ...getMachineRequestOptions(runtime, target),
  });
}

export function createMachineClient(
  runtime: AppRuntime,
  target: MachineTarget
): MachineClient {
  const queryScopeKey = ['machine', target.id] as const;

  return {
    target,
    queryScopeKey,
    getConfig: async () =>
      handleApiResponse<UserSystemInfo>(
        await makeMachineRequest(runtime, target, '/api/info', {
          cache: 'no-store',
        })
      ),
    saveConfig: async (config) =>
      handleApiResponse<Config>(
        await makeMachineRequest(runtime, target, '/api/config', {
          method: 'PUT',
          body: JSON.stringify(config),
        })
      ),
    listRepos: async () =>
      handleApiResponse<Repo[]>(
        await makeMachineRequest(runtime, target, '/api/repos')
      ),
    updateRepo: async (repoId, data) =>
      handleApiResponse<Repo>(
        await makeMachineRequest(runtime, target, `/api/repos/${repoId}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        })
      ),
    deleteRepo: async (repoId) =>
      handleApiResponse<void>(
        await makeMachineRequest(runtime, target, `/api/repos/${repoId}`, {
          method: 'DELETE',
        })
      ),
    registerRepo: async (data) =>
      handleApiResponse<Repo>(
        await makeMachineRequest(runtime, target, '/api/repos', {
          method: 'POST',
          body: JSON.stringify(data),
        })
      ),
    getRepoBranches: async (repoId) =>
      handleApiResponse<GitBranch[]>(
        await makeMachineRequest(
          runtime,
          target,
          `/api/repos/${repoId}/branches`
        )
      ),
    loadProfiles: async () =>
      handleApiResponse<{ content: string; path: string }>(
        await makeMachineRequest(runtime, target, '/api/profiles')
      ),
    saveProfiles: async (content) =>
      handleApiResponse<string>(
        await makeMachineRequest(runtime, target, '/api/profiles', {
          method: 'PUT',
          body: content,
          headers: {
            'Content-Type': 'application/json',
          },
        })
      ),
    loadMcpServers: async (query) => {
      const params = new URLSearchParams(query);
      return handleApiResponse<GetMcpServerResponse>(
        await makeMachineRequest(
          runtime,
          target,
          `/api/mcp-config?${params.toString()}`
        )
      );
    },
    saveMcpServers: async (query, data) => {
      const params = new URLSearchParams(query);
      await handleApiResponse<void>(
        await makeMachineRequest(
          runtime,
          target,
          `/api/mcp-config?${params.toString()}`,
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        )
      );
    },
    listAgentTools: async (projectPath) => {
      const params = new URLSearchParams();
      if (projectPath) params.set('project_path', projectPath);
      const query = params.size ? `?${params.toString()}` : '';
      return handleApiResponse<AgentToolInventoryView, AgentToolOperationError>(
        await makeMachineRequest(runtime, target, `/api/agent-tools${query}`)
      );
    },
    listAgentCommands: async (projectPath) => {
      const params = new URLSearchParams();
      if (projectPath) params.set('project_path', projectPath);
      const query = params.size ? `?${params.toString()}` : '';
      return handleApiResponse<
        AgentCommandInventoryView,
        AgentCommandOperationError
      >(
        await makeMachineRequest(runtime, target, `/api/agent-commands${query}`)
      );
    },
    getAgentGarage: async () =>
      handleApiResponse<AgentGarageEntry[]>(
        await makeMachineRequest(runtime, target, '/api/agents/garage', {
          cache: 'no-store',
        })
      ),
    createAgentTool: async (data) =>
      handleApiResponse<AgentToolView, AgentToolOperationError>(
        await makeMachineRequest(runtime, target, '/api/agent-tools', {
          method: 'POST',
          body: JSON.stringify(data),
        })
      ),
    updateAgentTool: async (data) =>
      handleApiResponse<AgentToolView, AgentToolOperationError>(
        await makeMachineRequest(runtime, target, '/api/agent-tools', {
          method: 'PUT',
          body: JSON.stringify(data),
        })
      ),
    removeAgentTool: async (data) =>
      handleApiResponse<void, AgentToolOperationError>(
        await makeMachineRequest(runtime, target, '/api/agent-tools/remove', {
          method: 'POST',
          body: JSON.stringify(data),
        })
      ),
    toggleAgentTool: async (data) =>
      handleApiResponse<AgentToolView, AgentToolOperationError>(
        await makeMachineRequest(runtime, target, '/api/agent-tools/toggle', {
          method: 'POST',
          body: JSON.stringify(data),
        })
      ),
    copyAgentTool: async (data) =>
      handleApiResponse<CopyAgentToolResponse, AgentToolOperationError>(
        await makeMachineRequest(runtime, target, '/api/agent-tools/copy', {
          method: 'POST',
          body: JSON.stringify(data),
        })
      ),
    revealAgentTool: async (data) =>
      handleApiResponse<AgentToolRevealResponse, AgentToolOperationError>(
        await makeMachineRequest(runtime, target, '/api/agent-tools/reveal', {
          method: 'POST',
          body: JSON.stringify(data),
        })
      ),
    createAgentCommand: async (data) =>
      handleApiResponse<AgentCommandView, AgentCommandOperationError>(
        await makeMachineRequest(runtime, target, '/api/agent-commands', {
          method: 'POST',
          body: JSON.stringify(data),
        })
      ),
    updateAgentCommand: async (data) =>
      handleApiResponse<AgentCommandView, AgentCommandOperationError>(
        await makeMachineRequest(runtime, target, '/api/agent-commands', {
          method: 'PUT',
          body: JSON.stringify(data),
        })
      ),
    removeAgentCommand: async (data) =>
      handleApiResponse<void, AgentCommandOperationError>(
        await makeMachineRequest(
          runtime,
          target,
          '/api/agent-commands/remove',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        )
      ),
    toggleAgentCommand: async (data) =>
      handleApiResponse<AgentCommandView, AgentCommandOperationError>(
        await makeMachineRequest(
          runtime,
          target,
          '/api/agent-commands/toggle',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        )
      ),
    discoverAgentSettings: async (query = {}) => {
      const params = new URLSearchParams();
      if (query.provider) params.set('provider', query.provider);
      if (query.project_path) params.set('project_path', query.project_path);
      const suffix = params.size ? `?${params.toString()}` : '';
      return handleApiResponse<
        AgentSettingsInventory,
        AgentSettingOperationError
      >(
        await makeMachineRequest(
          runtime,
          target,
          `/api/agent-settings${suffix}`,
          { cache: 'no-store' }
        )
      );
    },
    diffAgentSettings: async (data) =>
      handleApiResponse<SettingsDiff, AgentSettingOperationError>(
        await makeMachineRequest(runtime, target, '/api/agent-settings/diff', {
          method: 'POST',
          body: JSON.stringify(data),
        })
      ),
    applyAgentSettings: async (data) =>
      handleApiResponse<SettingsSnapshot, AgentSettingOperationError>(
        await makeMachineRequest(runtime, target, '/api/agent-settings/apply', {
          method: 'POST',
          body: JSON.stringify(data),
        })
      ),
    revealAgentSetting: async (data) =>
      handleApiResponse<RevealAgentSettingResponse, AgentSettingOperationError>(
        await makeMachineRequest(
          runtime,
          target,
          '/api/agent-settings/reveal',
          {
            method: 'POST',
            body: JSON.stringify(data),
            cache: 'no-store',
          }
        )
      ),
    diffAgentSettingsNativeFile: async (data) =>
      handleApiResponse<SettingsDiff, AgentSettingOperationError>(
        await makeMachineRequest(
          runtime,
          target,
          '/api/agent-settings/native-file/diff',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        )
      ),
    applyAgentSettingsNativeFile: async (data) =>
      handleApiResponse<SettingsSnapshot, AgentSettingOperationError>(
        await makeMachineRequest(
          runtime,
          target,
          '/api/agent-settings/native-file/apply',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        )
      ),
    listAgentSettingsProfiles: async (query = {}) => {
      const params = new URLSearchParams();
      if (query.provider) params.set('provider', query.provider);
      const suffix = params.size ? `?${params.toString()}` : '';
      return handleApiResponse<ConfigProfileView[], AgentSettingOperationError>(
        await makeMachineRequest(
          runtime,
          target,
          `/api/agent-settings/profiles${suffix}`,
          { cache: 'no-store' }
        )
      );
    },
    saveAgentSettingsProfile: async (data) =>
      handleApiResponse<ConfigProfileView, AgentSettingOperationError>(
        await makeMachineRequest(
          runtime,
          target,
          '/api/agent-settings/profiles',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        )
      ),
    updateAgentSettingsProfile: async (data) =>
      handleApiResponse<ConfigProfileView, AgentSettingOperationError>(
        await makeMachineRequest(
          runtime,
          target,
          '/api/agent-settings/profiles',
          {
            method: 'PUT',
            body: JSON.stringify(data),
          }
        )
      ),
    deleteAgentSettingsProfile: async (data) =>
      handleApiResponse<void, AgentSettingOperationError>(
        await makeMachineRequest(
          runtime,
          target,
          '/api/agent-settings/profiles/delete',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        )
      ),
    duplicateAgentSettingsProfile: async (data) =>
      handleApiResponse<ConfigProfileView, AgentSettingOperationError>(
        await makeMachineRequest(
          runtime,
          target,
          '/api/agent-settings/profiles/duplicate',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        )
      ),
    previewAgentSettingsProfileCopy: async (data) =>
      handleApiResponse<ProfileCopyPreview, AgentSettingOperationError>(
        await makeMachineRequest(
          runtime,
          target,
          '/api/agent-settings/profiles/copy-preview',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        )
      ),
    copyAgentSettingsProfile: async (data) =>
      handleApiResponse<ConfigProfileView, AgentSettingOperationError>(
        await makeMachineRequest(
          runtime,
          target,
          '/api/agent-settings/profiles/copy',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        )
      ),
    previewAgentSettingsProfileApply: async (data) =>
      handleApiResponse<SettingsDiff, AgentSettingOperationError>(
        await makeMachineRequest(
          runtime,
          target,
          '/api/agent-settings/profiles/apply-preview',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        )
      ),
    applyAgentSettingsProfile: async (data) =>
      handleApiResponse<SettingsSnapshot, AgentSettingOperationError>(
        await makeMachineRequest(
          runtime,
          target,
          '/api/agent-settings/profiles/apply',
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        )
      ),
  };
}
