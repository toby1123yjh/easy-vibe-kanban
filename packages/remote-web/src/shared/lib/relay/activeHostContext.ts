let activeRelayHostId: string | null = null;

export function setActiveRelayHostId(hostId: string | null): void {
  activeRelayHostId = hostId;
}

export function getActiveRelayHostId(): string | null {
  return activeRelayHostId;
}

export function resolveRelayRequestHostId(
  options: {
    relayHostId?: string | null;
    hostId?: string | null;
    hostScope?: string;
  },
  routeHostId: string | null,
): string | null {
  if (options.hostScope === "explicit") {
    return options.relayHostId ?? options.hostId ?? null;
  }
  return options.relayHostId ?? routeHostId ?? getActiveRelayHostId();
}
