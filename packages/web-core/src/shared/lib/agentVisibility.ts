import type { BaseCodingAgent } from 'shared/types';

function compactAgents(
  agents: readonly (BaseCodingAgent | null | undefined)[]
): BaseCodingAgent[] {
  return agents.filter((agent): agent is BaseCodingAgent => Boolean(agent));
}

export function isAgentHidden(
  agent: BaseCodingAgent | null | undefined,
  hiddenAgents?: readonly BaseCodingAgent[] | null
): boolean {
  if (!agent) return false;
  return new Set(hiddenAgents ?? []).has(agent);
}

export function filterVisibleAgents({
  agents,
  hiddenAgents,
  preserveAgents = [],
}: {
  agents: readonly BaseCodingAgent[];
  hiddenAgents?: readonly BaseCodingAgent[] | null;
  preserveAgents?: readonly (BaseCodingAgent | null | undefined)[];
}): BaseCodingAgent[] {
  const hidden = new Set(hiddenAgents ?? []);
  const preserved = new Set(compactAgents(preserveAgents));
  const visible: BaseCodingAgent[] = [];
  const seen = new Set<BaseCodingAgent>();

  for (const agent of agents) {
    if (seen.has(agent)) continue;
    if (hidden.has(agent) && !preserved.has(agent)) continue;
    visible.push(agent);
    seen.add(agent);
  }

  for (const agent of compactAgents(preserveAgents)) {
    if (seen.has(agent)) continue;
    visible.push(agent);
    seen.add(agent);
  }

  return visible;
}
