import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { CreateChatBoxContainer } from "@/shared/components/CreateChatBoxContainer";
import { fixture, useFixture } from "./mocks";
import { ManagedWorkspaceDirectoryField } from "@/shared/dialogs/settings/settings/ManagedWorkspaceDirectoryField";
import { settings, useSettingsFixture } from "./settings-mocks";

function SettingsFixture() {
  useSettingsFixture();
  return (
    <>
      <ManagedWorkspaceDirectoryField
        value={settings.value}
        onChange={settings.change}
        disabled={settings.disabled}
      />
      <output data-testid="value">{JSON.stringify(settings.value)}</output>
      <output data-testid="ready">fixture ready</output>
    </>
  );
}

function App() {
  useFixture();
  return (
    <>
      <CreateChatBoxContainer
        onWorkspaceCreated={(id) => fixture.created.push(id)}
        requiredLinkedIssue={
          new URLSearchParams(location.search).has("requiredIssue")
            ? {
                remoteProjectId: "project-1",
                issueId: "route-issue",
                simpleId: "P-ROUTE",
                title: "Route-owned Issue",
              }
            : undefined
        }
      />
      <output data-testid="ready">fixture ready</output>
    </>
  );
}
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    {new URLSearchParams(location.search).has("settings") ? (
      <SettingsFixture />
    ) : (
      <App />
    )}
  </QueryClientProvider>,
);
