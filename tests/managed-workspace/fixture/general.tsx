import React, { useCallback, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Config, UserSystemInfo } from 'shared/types';
import { GeneralSettingsSection } from '@/shared/dialogs/settings/settings/GeneralSettingsSection';
import { UserSystemContext } from '@/shared/hooks/useUserSystem';
import { useUserSystemController } from '@/shared/hooks/useUserSystemController';
import { general, useGeneralFixture } from './general-mocks';

const configs: Record<string, Config> = Object.fromEntries(
  ['a', 'b'].map((host) => [
    host,
    {
      managed_workspace_root: `/host-${host}`,
      theme: 'SYSTEM',
      language: 'EN',
      editor: { editor_type: 'VS_CODE' },
      notifications: {},
      git_branch_prefix: '',
    } as Config,
  ])
);
function App() {
  useGeneralFixture();
  const host = general.host;
  const queryKey = useMemo(() => ['general-fixture', host], [host]);
  const load = useCallback(
    async () => ({ config: configs[host] }) as UserSystemInfo,
    [host]
  );
  const save = useCallback(
    async (config: Config) => {
      general.saves.push({ host, root: config.managed_workspace_root });
      if (general.deferred)
        await new Promise<void>((resolve) => {
          general.finish = resolve;
        });
      if (general.fail) throw new Error('Rejected root');
      configs[host] = config;
      general.completions++;
      return config;
    },
    [host]
  );
  const { value } = useUserSystemController({ queryKey, load, save });
  return (
    <UserSystemContext.Provider value={value}>
      {general.visible && (
        <GeneralSettingsSection includeAgentSettings={false} />
      )}
    </UserSystemContext.Provider>
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <App />
  </QueryClientProvider>
);
