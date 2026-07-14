import { scratchApi, ApiError } from '@/shared/lib/api';
import {
  ScratchType,
  type DraftWorkspaceRepo,
  type ProjectRepoDefaultsData,
  type ScratchPayload,
} from 'shared/types';

const SCRATCH_TYPE = ScratchType.PROJECT_REPO_DEFAULTS;

export type ProjectWorkspaceDefault =
  | { kind: 'git'; repo: DraftWorkspaceRepo }
  | { kind: 'direct_folder'; path: string };

export const projectWorkspaceDefaultQueryKey = (
  projectId: string,
  hostId?: string | null
) => ['project-workspace-default', hostId ?? 'local', projectId] as const;

export function normalizeProjectWorkspaceDefault(
  data: Pick<ProjectRepoDefaultsData, 'repos' | 'directory_path'>
): ProjectWorkspaceDefault | null {
  const directoryPath = data.directory_path?.trim();
  if (directoryPath) {
    return { kind: 'direct_folder', path: directoryPath };
  }

  const [repo] = data.repos ?? [];
  return repo ? { kind: 'git', repo } : null;
}

export function areProjectWorkspaceDefaultsEqual(
  left: ProjectWorkspaceDefault | null,
  right: ProjectWorkspaceDefault | null
): boolean {
  if (left?.kind !== right?.kind) return false;
  if (!left || !right) return true;

  if (left.kind === 'direct_folder' && right.kind === 'direct_folder') {
    return left.path === right.path;
  }

  if (left.kind === 'git' && right.kind === 'git') {
    return (
      left.repo.repo_id === right.repo.repo_id &&
      left.repo.target_branch === right.repo.target_branch
    );
  }

  return false;
}

async function readProjectWorkspaceDefault(
  projectId: string,
  hostId?: string | null
): Promise<ProjectWorkspaceDefault | null> {
  const scratch = await scratchApi.get(SCRATCH_TYPE, projectId, hostId);
  const payload = scratch.payload as ScratchPayload;
  if (payload?.type !== 'PROJECT_REPO_DEFAULTS') return null;

  return normalizeProjectWorkspaceDefault(payload.data);
}

function isScratchNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * Read a project's workspace default from scratch storage.
 * Returns null if no default has been saved for this project.
 */
export async function getProjectWorkspaceDefault(
  projectId: string,
  hostId?: string | null
): Promise<ProjectWorkspaceDefault | null> {
  try {
    return await readProjectWorkspaceDefault(projectId, hostId);
  } catch (error) {
    if (isScratchNotFound(error)) {
      return null;
    }
    console.error('[useProjectRepoDefaults] Failed to read defaults:', error);
    return null;
  }
}

/**
 * Read a project workspace default while preserving non-404 failures for
 * visible UI.
 */
export async function getProjectWorkspaceDefaultOrThrow(
  projectId: string,
  hostId?: string | null
): Promise<ProjectWorkspaceDefault | null> {
  try {
    return await readProjectWorkspaceDefault(projectId, hostId);
  } catch (error) {
    if (isScratchNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/** Save exactly one Git or ordinary-directory project workspace default. */
export async function saveProjectWorkspaceDefault(
  projectId: string,
  workspaceDefault: ProjectWorkspaceDefault | null,
  hostId?: string | null
): Promise<void> {
  const data: ProjectRepoDefaultsData =
    workspaceDefault?.kind === 'git'
      ? { repos: [workspaceDefault.repo], directory_path: null }
      : {
          repos: [],
          directory_path:
            workspaceDefault?.kind === 'direct_folder'
              ? workspaceDefault.path.trim()
              : null,
        };

  await scratchApi.update(
    SCRATCH_TYPE,
    projectId,
    {
      payload: {
        type: 'PROJECT_REPO_DEFAULTS',
        data,
      },
    },
    hostId
  );
}

/**
 * Read the project default and filter out a stale registered Git repository.
 * Direct-folder defaults do not depend on repository registration.
 */
export async function getValidProjectWorkspaceDefault(
  projectId: string,
  availableRepoIds: Set<string>,
  hostId?: string | null
): Promise<ProjectWorkspaceDefault | null> {
  const workspaceDefault = await getProjectWorkspaceDefault(projectId, hostId);
  if (workspaceDefault?.kind !== 'git') {
    return workspaceDefault;
  }

  return availableRepoIds.has(workspaceDefault.repo.repo_id)
    ? workspaceDefault
    : null;
}
