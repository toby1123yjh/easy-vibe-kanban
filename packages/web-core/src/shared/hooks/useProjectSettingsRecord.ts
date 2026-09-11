import { useQuery } from '@tanstack/react-query';
import {
  fetchProjectSettingsRecord,
  projectSettingsQueryKey,
} from '@/shared/lib/projectSettings';

export function useProjectSettingsRecord(projectId: string) {
  return useQuery({
    queryKey: projectSettingsQueryKey(projectId),
    queryFn: () => fetchProjectSettingsRecord(projectId),
  });
}
