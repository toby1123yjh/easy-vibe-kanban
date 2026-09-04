import {
  invalidateRemoteSessionId,
  resolveRemoteHostContext,
  tryRefreshRelayHostSigningSession,
} from "@remote/shared/lib/relay/context";
import { resolveRelayRequestHostId } from "@remote/shared/lib/relay/activeHostContext";
import {
  isAuthFailureStatus,
  sendRelayHostRequest,
} from "@remote/shared/lib/relay/http";
import {
  isWorkspaceRoutePath,
  normalizePath,
  openBrowserWebSocket,
  requireRelayHostContext,
  resolveRelayHostIdForCurrentPage,
  shouldRelayApiPath,
  toPathAndQuery,
} from "@remote/shared/lib/relay/routing";
import {
  appendSignatureToPath,
  buildRelaySignature,
  normalizeRequestBody,
} from "@remote/shared/lib/relay/signing";
import {
  createRelaySignedWebSocket,
  createRelayWsSigningContext,
} from "@remote/shared/lib/relay/ws";
import { buildRemoteSessionBaseUrl } from "@/shared/lib/relayBackendApi";
import type {
  LocalApiRequestOptions,
  LocalApiWebSocketOptions,
} from "@/shared/lib/localApiTransport";
import { toFetchRequestInit } from "@/shared/lib/localApiTransport";

const EMPTY_BYTES = new Uint8Array();

export { isWorkspaceRoutePath };

export async function requestLocalApiViaRelay(
  pathOrUrl: string,
  requestInit: LocalApiRequestOptions = {},
): Promise<Response> {
  const pathAndQuery = toPathAndQuery(pathOrUrl);
  const { relayHostId, hostId, hostScope } = requestInit;
  const relayRequestInit = toFetchRequestInit(requestInit);

  if (!shouldRelayApiPath(pathAndQuery)) {
    return fetch(pathOrUrl, relayRequestInit);
  }

  const resolvedHostId = requireRelayHostContext(
    resolveRelayRequestHostId(
      { relayHostId, hostId, hostScope },
      resolveRelayHostIdForCurrentPage(),
    ),
    "request",
  );

  return requestRelayHostApi(resolvedHostId, pathAndQuery, relayRequestInit);
}

export async function openLocalApiWebSocketViaRelay(
  pathOrUrl: string,
  options: LocalApiWebSocketOptions = {},
): Promise<WebSocket> {
  const pathAndQuery = toPathAndQuery(pathOrUrl);

  if (!shouldRelayApiPath(pathAndQuery)) {
    return openBrowserWebSocket(pathOrUrl);
  }

  const hostId = requireRelayHostContext(
    resolveRelayRequestHostId(options, resolveRelayHostIdForCurrentPage()),
    "WebSocket",
  );

  return openRelayHostWebSocket(hostId, pathAndQuery);
}

export async function requestRelayHostApi(
  hostId: string,
  pathOrUrl: string,
  requestInit: RequestInit = {},
): Promise<Response> {
  const pathAndQuery = toPathAndQuery(pathOrUrl);
  const normalizedPath = normalizePath(pathAndQuery);
  const method = (requestInit.method ?? "GET").toUpperCase();

  const { body, bodyBytes, contentType } = await normalizeRequestBody(
    requestInit.body,
  );

  const context = await resolveRemoteHostContext(hostId);
  const initialResponse = await sendRelayHostRequest(context, {
    normalizedPath,
    method,
    body,
    bodyBytes,
    contentType,
    requestInit,
  });
  if (!isAuthFailureStatus(initialResponse.status)) {
    return initialResponse;
  }

  invalidateRemoteSessionId(hostId);
  const refreshedContext = await tryRefreshRelayHostSigningSession(context);
  if (!refreshedContext) {
    return initialResponse;
  }

  const retryResponse = await sendRelayHostRequest(refreshedContext, {
    normalizedPath,
    method,
    body,
    bodyBytes,
    contentType,
    requestInit,
  });
  if (isAuthFailureStatus(retryResponse.status)) {
    invalidateRemoteSessionId(hostId);
  }

  return retryResponse;
}

export async function openRelayHostWebSocket(
  hostId: string,
  pathOrUrl: string,
): Promise<WebSocket> {
  const baseContext = await resolveRemoteHostContext(hostId);
  const context =
    (await tryRefreshRelayHostSigningSession(baseContext)) ?? baseContext;
  const pathAndQuery = toPathAndQuery(pathOrUrl);
  const normalizedPath = normalizePath(pathAndQuery);

  const signature = await buildRelaySignature(
    context.pairedHost,
    "GET",
    normalizedPath,
    EMPTY_BYTES,
  );
  const base_url = buildRemoteSessionBaseUrl(
    context.pairedHost.host_id,
    context.sessionId,
  );

  const signedPath = appendSignatureToPath(normalizedPath, signature);
  const wsUrl = `${base_url}${signedPath}`.replace(/^http/i, "ws");

  const signingContext = await createRelayWsSigningContext(
    context.pairedHost,
    signature,
  );
  return createRelaySignedWebSocket(new WebSocket(wsUrl), signingContext);
}
