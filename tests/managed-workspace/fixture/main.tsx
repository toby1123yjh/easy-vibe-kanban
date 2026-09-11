import React from "react";
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
      />
      <output data-testid="ready">fixture ready</output>
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  new URLSearchParams(location.search).has("settings") ? (
    <SettingsFixture />
  ) : (
    <App />
  ),
);
