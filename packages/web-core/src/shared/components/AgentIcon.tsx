import { BaseCodingAgent } from 'shared/types';
import { useTheme, getResolvedTheme } from '@/shared/hooks/useTheme';

type AgentIconProps = {
  agent: BaseCodingAgent | null | undefined;
  className?: string;
};

export function getAgentName(
  agent: BaseCodingAgent | null | undefined
): string {
  if (!agent) return 'Agent';
  switch (agent) {
    case BaseCodingAgent.CLAUDE_CODE:
      return 'Claude Code';
    case BaseCodingAgent.GEMINI:
      return 'Gemini';
    case BaseCodingAgent.CODEX:
      return 'Codex';
    case BaseCodingAgent.OH_MY_PI:
      return 'Oh My Pi';
  }
}

export function AgentIcon({ agent, className = 'h-4 w-4' }: AgentIconProps) {
  const { theme } = useTheme();
  const resolvedTheme = getResolvedTheme(theme);
  const isDark = resolvedTheme === 'dark';
  const suffix = isDark ? '-dark' : '-light';

  if (!agent) {
    return null;
  }

  const agentName = getAgentName(agent);
  let iconPath = '';

  switch (agent) {
    case BaseCodingAgent.CLAUDE_CODE:
      iconPath = `/agents/claude${suffix}.svg`;
      break;
    case BaseCodingAgent.GEMINI:
      iconPath = `/agents/gemini${suffix}.svg`;
      break;
    case BaseCodingAgent.CODEX:
      iconPath = `/agents/codex${suffix}.svg`;
      break;
    case BaseCodingAgent.OH_MY_PI:
      iconPath = `/agents/oh-my-pi${suffix}.svg`;
      break;
    default:
      return null;
  }

  return <img src={iconPath} alt={agentName} className={className} />;
}
