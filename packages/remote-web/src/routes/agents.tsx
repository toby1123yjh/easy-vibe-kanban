import { createFileRoute } from "@tanstack/react-router";
import { AgentCenterPage } from "@/features/agent-center/ui/AgentCenterPage";
import { SettingsDirtyProvider } from "@/shared/dialogs/settings/settings/SettingsDirtyContext";
import { SettingsHostProvider } from "@/shared/dialogs/settings/settings/SettingsHostContext";
import { SettingsMachineUserSystemProvider } from "@/shared/dialogs/settings/settings/SettingsMachineUserSystemProvider";
import { requireAuthenticated } from "@remote/shared/lib/route-auth";

function AgentsRoute() {
  return (
    <SettingsDirtyProvider>
      <SettingsHostProvider>
        <SettingsMachineUserSystemProvider>
          <AgentCenterPage />
        </SettingsMachineUserSystemProvider>
      </SettingsHostProvider>
    </SettingsDirtyProvider>
  );
}

export const Route = createFileRoute("/agents")({
  beforeLoad: async ({ location }) => requireAuthenticated(location),
  component: AgentsRoute,
});
