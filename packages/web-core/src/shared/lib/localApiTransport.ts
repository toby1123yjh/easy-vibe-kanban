import { getCurrentHostId } from '@/shared/providers/HostIdProvider';

export type LocalApiHostScope = 'current' | 'explicit' | 'none';

export interface LocalApiRequestOptions extends RequestInit {
  hostScope?: LocalApiHostScope;
  hostId?: string | null;
  relayHostId?: string | null;
}

export interface LocalApiWebSocketOptions {
  hostScope?: LocalApiHostScope;
  hostId?: string | null;
  relayHostId?: string | null;
}

export interface LocalApiTransport {
  request: (
    pathOrUrl: string,
    init?: LocalApiRequestOptions
  ) => Promise<Response>;
  openWebSocket: (
    pathOrUrl: string,
    options?: LocalApiWebSocketOptions
  ) => Promise<WebSocket> | WebSocket;
}

export function toFetchRequestInit(
  options: LocalApiRequestOptions
): RequestInit {
  const requestInit = { ...options };
  delete requestInit.hostScope;
  delete requestInit.hostId;
  delete requestInit.relayHostId;
  return requestInit;
}

const LOCAL_ONLY_API_PREFIXES = [
  '/api/open-remote-editor/',
  '/api/relay-auth/server/',
  '/api/relay-auth/client/',
];

function isAbsoluteUrl(pathOrUrl: string): boolean {
  return /^https?:\/\//i.test(pathOrUrl) || /^wss?:\/\//i.test(pathOrUrl);
}

function toPathAndQuery(pathOrUrl: string): string {
  if (isAbsoluteUrl(pathOrUrl)) {
    const url = new URL(pathOrUrl);
    return `${url.pathname}${url.search}`;
  }
  return pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
}

function toAbsoluteWsUrl(pathOrUrl: string): string {
  if (/^wss?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl.replace(/^http/i, 'ws');

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${protocol}//${window.location.host}${path}`;
}

function scopeLocalApiPath(pathOrUrl: string, hostId: string | null): string {
  if (!hostId) return pathOrUrl;
  const path = toPathAndQuery(pathOrUrl);
  // These endpoints must always hit the local backend because they rely on
  // local-only credentials/state.
  if (LOCAL_ONLY_API_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return pathOrUrl;
  }

  if (!path.startsWith('/api/') || path.startsWith('/api/host/'))
    return pathOrUrl;

  const suffix = path.slice('/api'.length);
  return `/api/host/${hostId}${suffix}`;
}

function resolveScopedPath(
  pathOrUrl: string,
  options: {
    hostScope?: LocalApiHostScope;
    hostId?: string | null;
  } = {}
): string {
  const hostScope = options.hostScope ?? 'current';

  if (hostScope === 'none') {
    return pathOrUrl;
  }

  if (hostScope === 'explicit') {
    return scopeLocalApiPath(pathOrUrl, options.hostId ?? null);
  }

  return scopeLocalApiPath(pathOrUrl, getCurrentHostId());
}

const defaultTransport: LocalApiTransport = {
  request: (pathOrUrl, init = {}) => {
    const scopedPath = resolveScopedPath(pathOrUrl, init);
    return fetch(scopedPath, toFetchRequestInit(init));
  },
  openWebSocket: (pathOrUrl, options = {}) =>
    new WebSocket(toAbsoluteWsUrl(resolveScopedPath(pathOrUrl, options))),
};

let transport: LocalApiTransport = defaultTransport;

export function setLocalApiTransport(nextTransport: LocalApiTransport | null) {
  transport = nextTransport ?? defaultTransport;
}

export async function makeLocalApiRequest(
  pathOrUrl: string,
  init: LocalApiRequestOptions = {}
): Promise<Response> {
  // Explicit Host identity is interpreted by each installed transport. This
  // keeps Remote relay requests unscoped while the local default transport
  // still turns the identity into /api/host/{id}.
  const resolvedPath =
    init.hostScope === 'explicit'
      ? pathOrUrl
      : resolveScopedPath(pathOrUrl, init);
  return transport.request(resolvedPath, init);
}

export async function openLocalApiWebSocket(
  pathOrUrl: string,
  options: LocalApiWebSocketOptions = {}
): Promise<WebSocket> {
  const resolvedPath =
    options.hostScope === 'explicit'
      ? pathOrUrl
      : resolveScopedPath(pathOrUrl, options);
  return transport.openWebSocket(resolvedPath, options);
}
