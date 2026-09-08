type ScopedOptions = RequestInit & {
  hostId?: string | null;
  hostScope?: string;
  relayHostId?: string | null;
};

// Production API wrappers remain real. Only the final transport is isolated.
export function makeLocalApiRequest(path: string, options: ScopedOptions = {}) {
  const url = new URL(`/__fixture${path}`, location.origin);
  url.searchParams.set('fixture_host', options.hostId ?? 'local');
  url.searchParams.set('fixture_scope', options.hostScope ?? 'missing');
  const {
    hostId: _host,
    hostScope: _scope,
    relayHostId: _relay,
    ...init
  } = options;
  return fetch(url, init);
}

export function makeRequest(): never {
  throw new Error('Fixture must not reach Remote API');
}
