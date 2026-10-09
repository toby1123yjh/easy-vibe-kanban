import { useQuery } from '@tanstack/react-query';
import { organizationsApi } from '@/shared/lib/api';
import { useAuth } from '@/shared/hooks/auth/useAuth';
import type { ListOrganizationsResponse } from 'shared/types';
import { organizationKeys } from '@/shared/hooks/organizationKeys';
import { useHostId } from '@/shared/providers/HostIdProvider';
import { isLocalRemoteApiEnabled } from '@/shared/lib/remoteApi';

/**
 * Hook to fetch all organizations that the current user is a member of
 */
export function useUserOrganizations(options?: { hostId?: string | null }) {
  const { isSignedIn } = useAuth();
  const routeHostId = useHostId();
  const hostId = isLocalRemoteApiEnabled()
    ? options?.hostId !== undefined
      ? options.hostId
      : routeHostId
    : null;

  return useQuery<ListOrganizationsResponse>({
    queryKey: hostId
      ? [...organizationKeys.userList(), hostId]
      : organizationKeys.userList(),
    queryFn: () => organizationsApi.getUserOrganizations(hostId),
    enabled: isSignedIn,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
