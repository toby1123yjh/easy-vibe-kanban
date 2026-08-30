export function buildWorkspaceSessionHref(
  workspaceHref: string | null | undefined,
  sessionId: string | null | undefined
): string | null {
  if (!workspaceHref || !sessionId) return null;

  const [pathAndQuery, hash] = workspaceHref.split('#');
  const separator = pathAndQuery.includes('?') ? '&' : '?';
  const nextHref = `${pathAndQuery}${separator}session_id=${encodeURIComponent(
    sessionId
  )}`;

  return hash ? `${nextHref}#${hash}` : nextHref;
}
