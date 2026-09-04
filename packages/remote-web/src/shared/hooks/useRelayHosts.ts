import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RelayHost } from "shared/remote-types";
import { listPairedRelayHosts } from "@/shared/lib/relayPairingStorage";
import { listRelayHosts } from "@/shared/lib/remoteApi";

const RELAY_HOSTS_QUERY_KEY = ["relay-hosts", "hosts"] as const;
const RELAY_PAIRED_HOSTS_QUERY_KEY = ["relay-hosts", "paired-hosts"] as const;

export type RelayHostStatus = "online" | "offline" | "unpaired";

export interface RelayHostItem {
  id: string;
  name: string;
  status: RelayHostStatus;
}

interface UseRelayHostsResult {
  hosts: RelayHostItem[];
  isLoading: boolean;
}

export interface ResolveRelayNavigationHostOptions {
  routeHostId?: string | null;
}

export function resolveRelayNavigationHostId(
  hosts: RelayHostItem[],
  options?: ResolveRelayNavigationHostOptions,
): string | null {
  const routeHostId = options?.routeHostId ?? null;
  if (routeHostId) {
    return routeHostId;
  }

  const onlineHost = hosts.find((host) => host.status === "online");
  if (onlineHost) {
    return onlineHost.id;
  }

  return null;
}

function mapRelayHostStatus(
  host: RelayHost,
  pairedHostIds: Set<string>,
): RelayHostStatus {
  if (!pairedHostIds.has(host.id)) {
    return "unpaired";
  }

  return host.status === "online" ? "online" : "offline";
}

export function useRelayHosts(enabled: boolean): UseRelayHostsResult {
  const hostsQuery = useQuery({
    queryKey: RELAY_HOSTS_QUERY_KEY,
    queryFn: listRelayHosts,
    enabled,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const pairedHostsQuery = useQuery({
    queryKey: RELAY_PAIRED_HOSTS_QUERY_KEY,
    queryFn: async () => {
      try {
        return await listPairedRelayHosts();
      } catch (error) {
        console.error("Failed to load paired relay hosts", error);
        return [];
      }
    },
    enabled,
    staleTime: 5_000,
    refetchInterval: 5_000,
  });

  const hosts = useMemo<RelayHostItem[]>(() => {
    if (!enabled) {
      return [];
    }

    const relayHosts = hostsQuery.data ?? [];
    const pairedHostIds = new Set(
      (pairedHostsQuery.data ?? []).map((host) => host.host_id),
    );

    return relayHosts.map((host) => ({
      id: host.id,
      name: host.name,
      status: mapRelayHostStatus(host, pairedHostIds),
    }));
  }, [enabled, hostsQuery.data, pairedHostsQuery.data]);

  return {
    hosts,
    isLoading: enabled && (hostsQuery.isLoading || pairedHostsQuery.isLoading),
  };
}
