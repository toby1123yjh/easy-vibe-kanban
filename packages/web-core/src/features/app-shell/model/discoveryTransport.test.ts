import { expect, test } from '@playwright/test';
import { createDiscoveryRequestOptions } from '../../../shared/lib/executionDataDiscovery';
import {
  resolveRelayRequestHostId,
  setActiveRelayHostId,
} from '../../../../../remote-web/src/shared/lib/relay/activeHostContext';
import {
  makeLocalApiRequest,
  setLocalApiTransport,
  type LocalApiRequestOptions,
} from '../../../shared/lib/localApiTransport';

const nativeFetch = globalThis.fetch;

test.afterEach(() => {
  setLocalApiTransport(null);
  setActiveRelayHostId(null);
  globalThis.fetch = nativeFetch;
});

test('passes an atomic Host binding and cancellation signal to the installed transport', async () => {
  const calls: { path: string; options?: LocalApiRequestOptions }[] = [];
  setLocalApiTransport({
    request: async (path, options) => {
      calls.push({ path, options });
      return new Response();
    },
    openWebSocket: () => {
      throw new Error('WebSocket is not used by discovery');
    },
  });
  const signal = new AbortController().signal;

  const options = createDiscoveryRequestOptions({ hostId: 'host-a', signal });
  await makeLocalApiRequest('/api/projects?limit=5', options);

  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    path: '/api/projects?limit=5',
    options: {
      hostScope: 'explicit',
      hostId: 'host-a',
      relayHostId: 'host-a',
      signal,
    },
  });
});

test('fails closed when discovery explicitly has no Host', () => {
  expect(createDiscoveryRequestOptions({ hostId: null })).toMatchObject({
    hostScope: 'explicit',
    hostId: null,
    relayHostId: null,
  });
  expect(createDiscoveryRequestOptions({})).toBeUndefined();
});

test('turns the same explicit Host binding into a local Host API path', async () => {
  let requestedPath: string | null = null;
  let requestedInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestedPath = String(input);
    requestedInit = init;
    return new Response();
  };
  setLocalApiTransport(null);

  const signal = new AbortController().signal;

  await makeLocalApiRequest('/api/projects?limit=5', {
    hostScope: 'explicit',
    hostId: 'host-a',
    relayHostId: 'host-a',
    signal,
  });

  expect(requestedPath).toBe('/api/host/host-a/projects?limit=5');
  expect(requestedInit).toMatchObject({ signal });
  expect(requestedInit).not.toHaveProperty('hostScope');
  expect(requestedInit).not.toHaveProperty('hostId');
  expect(requestedInit).not.toHaveProperty('relayHostId');
});

test('shares fail-closed explicit Host resolution across Remote transports', () => {
  setActiveRelayHostId('old-host');

  expect(
    resolveRelayRequestHostId(
      { hostScope: 'explicit', hostId: 'new-host' },
      'route-host'
    )
  ).toBe('new-host');
  expect(
    resolveRelayRequestHostId(
      { hostScope: 'explicit', hostId: null },
      'route-host'
    )
  ).toBeNull();
  expect(resolveRelayRequestHostId({}, 'route-host')).toBe('route-host');
});
