import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../../packages/web-core/src/shared/dialogs/org",
  testMatch: "projectCreationWorkspace.test.ts",
  fullyParallel: true,
  workers: 1,
  reporter: "list",
});
