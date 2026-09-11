import { defineConfig } from "vite";
import base from "./vite.config";

const fixture = `${process.cwd()}/tests/page-surfaces/create-project-fixture`;
export default defineConfig({
  ...base,
  root: fixture,
  resolve: {
    alias: [
      ...[
        "@/shared/integrations/electric/hooks",
        "@/shared/dialogs/settings/settings/SettingsHostContext",
        "@/shared/dialogs/shared/WorkspaceTargetDialog",
        "@/shared/hooks/useProjectRepoDefaults",
      ].map((find) => ({ find, replacement: `${fixture}/mocks.tsx` })),
      ...Object.entries(base.resolve!.alias!).map(([find, replacement]) => ({
        find,
        replacement: replacement as string,
      })),
    ],
  },
});
