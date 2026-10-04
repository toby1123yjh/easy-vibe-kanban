/** Workflow authority uses the MCP from this exact server bundle, not PATH. */
export function requiredBinaryNames(baseName: string, platform: string): string[] {
  const names = baseName === 'vibe-kanban'
    ? ['vibe-kanban', 'agent-process-host', 'vibe-kanban-mcp']
    : [baseName];
  return names.map((name) => platform === 'win32' ? `${name}.exe` : name);
}

export function assertBundleEntries(
  baseName: string,
  platform: string,
  entryNames: string[],
): void {
  const missing = requiredBinaryNames(baseName, platform)
    .filter((name) => !entryNames.includes(name));
  if (missing.length > 0) {
    throw new Error(`Incomplete ${baseName} bundle: missing ${missing.join(', ')}. Reinstall this version; global Agent/MCP binaries cannot replace bundled components.`);
  }
}
