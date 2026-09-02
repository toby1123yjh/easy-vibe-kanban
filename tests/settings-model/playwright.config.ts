import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../../packages/web-core/src/features",
  testMatch: [
    "settings/model/settingsRoute.test.ts",
    "settings/model/appUpdate.test.ts",
    "agent-center/model/agentCenterState.test.ts",
  ],
  fullyParallel: true,
  workers: 1,
  reporter: "list",
});
