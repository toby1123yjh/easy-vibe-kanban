import type { LocalApiRequestOptions } from './localApiTransport';

export interface DiscoveryRequestOptions {
  hostId?: string | null;
  signal?: AbortSignal;
}

export function createDiscoveryRequestOptions(
  options: DiscoveryRequestOptions
): LocalApiRequestOptions | undefined {
  if (options.hostId === undefined && !options.signal) return undefined;
  return {
    hostScope: 'explicit',
    hostId: options.hostId ?? null,
    relayHostId: options.hostId ?? null,
    signal: options.signal,
  };
}
