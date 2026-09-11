import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import NiceModal from '@ebay/nice-modal-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { CreateRemoteProjectDialog } from '@/shared/dialogs/org/CreateRemoteProjectDialog';
import { GitConnectionsEditor } from '@/shared/dialogs/settings/settings/GitConnectionsSettings';
import { GitProjectImportPanel } from '@/shared/components/GitProjectImportPanel';
import { SettingsDirtyProvider } from '@/shared/dialogs/settings/settings/SettingsDirtyContext';
import i18n from '@/i18n/config';
import '@vibe/ui/styles/tokens.css';
void i18n.changeLanguage('en');
function Fixture() {
  const [host, setHost] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  return (
    <>
      <button
        onClick={() =>
          void CreateRemoteProjectDialog.show({ organizationId: 'org-fixture' })
        }
      >
        Open create project
      </button>
      <button onClick={() => setHost(host ? null : 'remote-1')}>
        Switch host
      </button>
      <button onClick={() => setEnabled((v) => !v)}>Toggle availability</button>
      {new URLSearchParams(location.search).has('panel') && (
        <GitProjectImportPanel
          key={host ?? 'local'}
          hostId={host}
          recoveryScope="fixture"
          enabled={enabled}
          onBusyChange={() => {}}
          onReady={(selection) => {
            document.documentElement.dataset.ready = JSON.stringify(selection);
          }}
        />
      )}
      {new URLSearchParams(location.search).has('settings') && (
        <SettingsDirtyProvider>
          <GitConnectionsEditor
            key={host ?? 'local'}
            hostId={host}
            enabled={enabled}
          />
        </SettingsDirtyProvider>
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <HotkeysProvider>
      <NiceModal.Provider>
        <Fixture />
      </NiceModal.Provider>
    </HotkeysProvider>
  </QueryClientProvider>,
);
