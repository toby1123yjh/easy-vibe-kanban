import { useQuery } from '@tanstack/react-query';
import { workflowManagementApi } from '@/shared/lib/workflowManagementApi';
import { useHostId } from '@/shared/providers/HostIdProvider';

export function useWorkflowMainSessionContext(sessionId?: string) {
  const hostId = useHostId();
  return useQuery({
    queryKey: ['workflow-management', hostId, 'context', sessionId],
    queryFn: ({ signal }) =>
      workflowManagementApi.context(sessionId!, signal, hostId),
    enabled: !!sessionId,
    refetchInterval: (query) => (query.state.data ? 5_000 : false),
  });
}

export function useWorkflowNotifications(sessionId?: string) {
  const hostId = useHostId();
  const context = useWorkflowMainSessionContext(sessionId);
  const notifications = useQuery({
    queryKey: ['workflow-management', hostId, 'notifications', sessionId],
    queryFn: ({ signal }) =>
      workflowManagementApi.notifications(sessionId!, signal, hostId),
    enabled: !!sessionId && !!context.data,
    // Refresh every loaded page, including resolved historical interactions.
    // A sequence-only tail would leave old human waits looking actionable.
    refetchInterval: 5_000,
  });
  return { context, notifications };
}
