import { useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  parseSettingsSearch,
  type ResolvedSettingsRoute,
  type SettingsSearchParams,
} from "@/features/settings/model/settingsRoute";
import { SettingsPage } from "@/features/settings/ui/SettingsPage";
import { SettingsDirtyProvider } from "@/shared/dialogs/settings/settings/SettingsDirtyContext";
import { SettingsHostProvider } from "@/shared/dialogs/settings/settings/SettingsHostContext";
import { SettingsMachineUserSystemProvider } from "@/shared/dialogs/settings/settings/SettingsMachineUserSystemProvider";
import { requireAuthenticated } from "@remote/shared/lib/route-auth";

function SettingsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const handleSearchChange = useCallback(
    (next: ResolvedSettingsRoute, options?: { replace?: boolean }) => {
      void navigate({ search: next, replace: options?.replace });
    },
    [navigate],
  );

  return (
    <SettingsDirtyProvider>
      <SettingsHostProvider>
        <SettingsMachineUserSystemProvider>
          <SettingsPage search={search} onSearchChange={handleSearchChange} />
        </SettingsMachineUserSystemProvider>
      </SettingsHostProvider>
    </SettingsDirtyProvider>
  );
}

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ location }) => requireAuthenticated(location),
  validateSearch: (search: Record<string, unknown>): SettingsSearchParams =>
    parseSettingsSearch(search),
  component: SettingsRoute,
});
