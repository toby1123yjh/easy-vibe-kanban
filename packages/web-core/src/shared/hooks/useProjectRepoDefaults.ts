import { scratchApi, ApiError } from '@/shared/lib/api';
import {
  ScratchType,
  type DraftWorkspaceRepo,
  type ScratchPayload,
} from 'shared/types';

const SCRATCH_TYPE = ScratchType.PROJECT_REPO_DEFAULTS;

async function readProjectRepoDefaults(
  projectId: string,
  hostId?: string | null
): Promise<DraftWorkspaceRepo[] | null> {
  const scratch = await scratchApi.get(SCRATCH_TYPE, projectId, hostId);
  const payload = scratch.payload as ScratchPayload;
  if (payload?.type === 'PROJECT_REPO_DEFAULTS') {
    return payload.data.repos;
  }
  return null;
}

function isScratchNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/**
 * Read project repo defaults from scratch storage.
 * Returns null if no defaults have been saved for this project.
 */
export async function getProjectRepoDefaults(
  projectId: string,
  hostId?: string | null
): Promise<DraftWorkspaceRepo[] | null> {
  try {
    return await readProjectRepoDefaults(projectId, hostId);
  } catch (error) {
    // 404 means no defaults saved yet — not an error
    if (isScratchNotFound(error)) {
      return null;
    }
    console.error('[useProjectRepoDefaults] Failed to read defaults:', error);
    return null;
  }
}

/**
 * Read project repo defaults while preserving non-404 failures for visible UI.
 * Use this when "not configured" must not mask an unavailable saved setting.
 */
export async function getProjectRepoDefaultsOrThrow(
  projectId: string,
  hostId?: string | null
): Promise<DraftWorkspaceRepo[] | null> {
  try {
    return await readProjectRepoDefaults(projectId, hostId);
  } catch (error) {
    if (isScratchNotFound(error)) {
      return null;
    }
    throw error;
  }
}

/**
 * Save project repo defaults to scratch storage (upsert).
 */
export async function saveProjectRepoDefaults(
  projectId: string,
  repos: DraftWorkspaceRepo[],
  hostId?: string | null
): Promise<void> {
  const [defaultRepo] = repos;
  await scratchApi.update(
    SCRATCH_TYPE,
    projectId,
    {
      payload: {
        type: 'PROJECT_REPO_DEFAULTS',
        data: { repos: defaultRepo ? [defaultRepo] : [] },
      },
    },
    hostId
  );
}

/**
 * Read the single project repo default and filter out a stale repository.
 * Returns an empty array if no defaults are saved or all saved repos are stale.
 */
export async function getValidProjectRepoDefaults(
  projectId: string,
  availableRepoIds: Set<string>,
  hostId?: string | null
): Promise<DraftWorkspaceRepo[]> {
  const defaults = await getProjectRepoDefaults(projectId, hostId);
  if (!defaults) {
    return [];
  }
  const [defaultRepo] = defaults;
  return defaultRepo && availableRepoIds.has(defaultRepo.repo_id)
    ? [defaultRepo]
    : [];
}
