import {
  PROJECTS_SHAPE,
  PROJECT_MUTATION,
  type Project,
} from 'shared/remote-types';
import { createShapeCollection } from '@/shared/lib/electric/collections';
import { makeRequest } from '@/shared/lib/remoteApi';
import { getCurrentHostId } from '@/shared/providers/HostIdProvider';

export const projectSettingsQueryKey = (
  projectId: string,
  hostId: string | null = null
) => ['project-settings', projectId, hostId] as const;

export async function fetchProjectSettingsRecord(
  projectId: string,
  hostId = getCurrentHostId()
): Promise<Project | null> {
  const response = await makeRequest(
    `/v1/projects/${encodeURIComponent(projectId)}`,
    {},
    true,
    hostId
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Could not load project settings');
  return response.json();
}

/** Resolve ownership from the project itself, never from the selected org. */
export async function deleteProjectById(
  projectId: string,
  canDelete: () => boolean,
  hostId = getCurrentHostId()
): Promise<void> {
  const project = await fetchProjectSettingsRecord(projectId, hostId);
  if (!project) throw new Error('Project not found');
  const collection = createShapeCollection(
    PROJECTS_SHAPE,
    { organization_id: project.organization_id },
    { hostId },
    PROJECT_MUTATION
  );
  await collection.preload();
  if (!canDelete())
    throw new Error('Project scope changed. Reopen the project menu.');
  // Keep the board/editor mounted on a rejected delete so its confirmation can
  // retry. Optimistic removal tears down the owner before persistence settles.
  await collection.delete(projectId, { optimistic: false }).isPersisted.promise;
}
