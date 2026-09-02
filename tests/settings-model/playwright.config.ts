import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../../packages/web-core/src/features/settings/model",
  testMatch: ["settingsRoute.test.ts", "appUpdate.test.ts"],
  fullyParallel: true,
  workers: 1,
  reporter: "list",
});
