import type { BaseCodingAgent } from 'shared/types';

// Wire contract owned by the server's agent installation routes.
export interface AgentInstallRequest {
  executor: BaseCodingAgent;
  npm_registry?: string;
}

export interface AgentInstallJob {
  id: string;
  executor: BaseCodingAgent;
  status: 'running' | 'succeeded' | 'failed';
  logs: string;
  error: string | null;
}

export function agentInstallRequest(
  executor: BaseCodingAgent,
  registry: string
): AgentInstallRequest {
  const trimmed = registry.trim();
  return {
    executor,
    ...(supportsNpmRegistry(executor) && trimmed
      ? { npm_registry: trimmed }
      : {}),
  };
}

export function supportsNpmRegistry(executor: BaseCodingAgent): boolean {
  return executor === 'CODEX' || executor === 'GEMINI';
}

export function isValidInstallRegistry(registry: string): boolean {
  const trimmed = registry.trim();
  if (!trimmed) return true;
  if (trimmed.length > 2048) return false;
  try {
    const url = new URL(trimmed);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
