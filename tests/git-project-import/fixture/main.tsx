import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import NiceModal from "@ebay/nice-modal-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HotkeysProvider } from "react-hotkeys-hook";
import { CreateRemoteProjectDialog } from "@/shared/dialogs/org/CreateRemoteProjectDialog";
import { GitConnectionsEditor } from "@/shared/dialogs/settings/settings/GitConnectionsSettings";
import { IntegrationSettingsEditor } from "@/features/settings/ui/IntegrationSettings";
import { WorkflowRunResult } from "@/features/workflow/ui/WorkflowRunResult";
import { WorkflowExternalAccessSwitch } from "@/features/workflow/ui/WorkflowExternalAccessSwitch";
import { GitProjectImportPanel } from "@/shared/components/GitProjectImportPanel";
import { SettingsDirtyProvider } from "@/shared/dialogs/settings/settings/SettingsDirtyContext";
import { AppRuntimeProvider } from "@/shared/hooks/useAppRuntime";
import { FolderPickerDialog } from "@/shared/dialogs/shared/FolderPickerDialog";
import i18n from "@/i18n/config";
import "@vibe/ui/styles/tokens.css";
void i18n.changeLanguage("en");
function Fixture() {
  const [host, setHost] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [directory, setDirectory] = useState("/previous");
  return (
    <>
      <button
        onClick={async () => {
          const selected = await FolderPickerDialog.show({
            value: directory,
            hostId: host,
          });
          if (selected !== null) setDirectory(selected);
        }}
      >
        Choose directory
      </button>
      <output aria-label="Selected directory">{directory}</output>
      <button
        onClick={() =>
          void CreateRemoteProjectDialog.show({ organizationId: "org-fixture" })
        }
      >
        Open create project
      </button>
      <button onClick={() => setHost(host ? null : "remote-1")}>
        Switch host
      </button>
      <button onClick={() => setEnabled((v) => !v)}>Toggle availability</button>
      {new URLSearchParams(location.search).has("panel") && (
        <GitProjectImportPanel
          key={host ?? "local"}
          hostId={host}
          recoveryScope="fixture"
          enabled={enabled}
          onBusyChange={() => {}}
          onReady={(selection) => {
            document.documentElement.dataset.ready = JSON.stringify(selection);
          }}
        />
      )}
      {new URLSearchParams(location.search).has("settings") && (
        <SettingsDirtyProvider>
          <GitConnectionsEditor
            key={host ?? "local"}
            hostId={host}
            enabled={enabled}
          />
        </SettingsDirtyProvider>
      )}
      {new URLSearchParams(location.search).has("integrations") && (
        <SettingsDirtyProvider>
          <IntegrationSettingsEditor key={host ?? "local"} hostId={host} enabled={enabled} />
        </SettingsDirtyProvider>
      )}
      {new URLSearchParams(location.search).has("result") && (
        <WorkflowRunResult run={{
          id: "run-1", orchestration_run_id: null, workflow_id: "template-1",
          attempt_id: null, issue_id: "issue-1", workspace_id: null,
          trigger_source: "external", input_text: "Prepare a report",
          output_text: "Report ready", status: "succeeded", started_at: null,
          finished_at: null, error_text: null, created_at: "2026-09-29T00:00:00Z",
          updated_at: "2026-09-29T00:00:00Z", nodes: [],
        }} />
      )}
      {new URLSearchParams(location.search).has("externalSwitch") && (
        <WorkflowExternalAccessSwitch workflowId="template-1" enabled={false} />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <AppRuntimeProvider runtime="local">
      <HotkeysProvider>
        <NiceModal.Provider>
          <Fixture />
        </NiceModal.Provider>
      </HotkeysProvider>
    </AppRuntimeProvider>
  </QueryClientProvider>,
);
