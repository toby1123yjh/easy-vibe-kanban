import { createFileRoute } from "@tanstack/react-router";
import type { BaseCodingAgent } from "shared/types";
import { AgentCenterPage } from "@/features/agent-center/ui/AgentCenterPage";
import { agentExecutorFromSearch } from "@/shared/lib/agentProviders";
import { SettingsDirtyProvider } from "@/shared/dialogs/settings/settings/SettingsDirtyContext";
import { SettingsHostProvider } from "@/shared/dialogs/settings/settings/SettingsHostContext";
import { SettingsMachineUserSystemProvider } from "@/shared/dialogs/settings/settings/SettingsMachineUserSystemProvider";
import { requireAuthenticated } from "@remote/shared/lib/route-auth";

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

export const Route = createFileRoute("/agents")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { provider?: BaseCodingAgent } => ({
    provider: agentExecutorFromSearch(search.provider),
  }),
  beforeLoad: async ({ location }) => requireAuthenticated(location),
  component: AgentsRoute,
});
