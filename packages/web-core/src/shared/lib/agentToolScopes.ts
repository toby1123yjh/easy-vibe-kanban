import type {
  AgentToolKind,
  AgentToolProviderInventoryView,
  AgentToolScope,
} from 'shared/types';

export function supportedAgentToolScopes(
  inventory:
    | Pick<AgentToolProviderInventoryView, 'mcp_scopes' | 'skill_scopes'>
    | null
    | undefined,
  kind: AgentToolKind
): readonly AgentToolScope[] {
  return (
    (kind === 'mcp_server' ? inventory?.mcp_scopes : inventory?.skill_scopes) ??
    []
  );
}
