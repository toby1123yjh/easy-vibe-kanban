import { useQuery } from '@tanstack/react-query';
import {
  fetchProjectSettingsRecord,
  projectSettingsQueryKey,
} from '@/shared/lib/projectSettings';
import { useHostId } from '@/shared/providers/HostIdProvider';

export function useProjectSettingsRecord(projectId: string) {
  const hostId = useHostId();
  return useQuery({
    queryKey: projectSettingsQueryKey(projectId, hostId),
    queryFn: () => fetchProjectSettingsRecord(projectId, hostId),
  });
}
