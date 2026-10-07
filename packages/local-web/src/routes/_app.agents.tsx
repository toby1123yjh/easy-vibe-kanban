import { createFileRoute } from '@tanstack/react-router';
import type { BaseCodingAgent } from 'shared/types';
import { AgentCenterPage } from '@/features/agent-center/ui/AgentCenterPage';
import { agentExecutorFromSearch } from '@/shared/lib/agentProviders';
import { SettingsDirtyProvider } from '@/shared/dialogs/settings/settings/SettingsDirtyContext';
import { SettingsHostProvider } from '@/shared/dialogs/settings/settings/SettingsHostContext';
import { SettingsMachineUserSystemProvider } from '@/shared/dialogs/settings/settings/SettingsMachineUserSystemProvider';

function AgentsRoute() {
  const { provider } = Route.useSearch();
  return (
    <SettingsDirtyProvider>
      <SettingsHostProvider>
        <SettingsMachineUserSystemProvider>
          <AgentCenterPage initialExecutor={provider} />
        </SettingsMachineUserSystemProvider>
      </SettingsHostProvider>
    </SettingsDirtyProvider>
  );
}

export const Route = createFileRoute('/_app/agents')({
  validateSearch: (
    search: Record<string, unknown>
  ): { provider?: BaseCodingAgent } => ({
    provider: agentExecutorFromSearch(search.provider),
  }),
  component: AgentsRoute,
});
