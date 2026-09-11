import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AgentCenterPage } from '../../../../packages/web-core/src/features/agent-center/ui/AgentCenterPage';
import {
  SettingsHostProvider,
  useSettingsHost,
} from '../../../../packages/web-core/src/shared/dialogs/settings/settings/SettingsHostContext';
import '../../../../packages/web-core/src/i18n/config';
import '../../../../packages/ui/src/styles/tokens.css';
import './style.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

const root = document.getElementById('root');
if (!root) throw new Error('Agent Center fixture root is missing');

function HostDiscoveryProbe() {
  const { hostDiscovery, remoteHostDiscovery } = useSettingsHost();
  return (
    <output
      hidden
      data-testid="host-discovery-probe"
      data-canonical={hostDiscovery.hasCanonicalData}
      data-host-error={hostDiscovery.error != null}
      data-remote-error={remoteHostDiscovery.error != null}
    />
  );
}

createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <main className="fixture-shell">
      <SettingsHostProvider>
        <HostDiscoveryProbe />
        <AgentCenterPage />
      </SettingsHostProvider>
    </main>
  </QueryClientProvider>
);
