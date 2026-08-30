import { createFileRoute } from '@tanstack/react-router';
import { AgentCenterPage } from '@/features/agent-center/ui/AgentCenterPage';
import { SettingsDirtyProvider } from '@/shared/dialogs/settings/settings/SettingsDirtyContext';
import { SettingsHostProvider } from '@/shared/dialogs/settings/settings/SettingsHostContext';
import { SettingsMachineUserSystemProvider } from '@/shared/dialogs/settings/settings/SettingsMachineUserSystemProvider';

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

export const Route = createFileRoute('/_app/agents')({
  component: AgentsRoute,
});
