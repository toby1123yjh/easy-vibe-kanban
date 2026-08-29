import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../../packages/web-core/src/features/agent-workbench/model",
  testMatch: ["*.test.ts"],
  fullyParallel: true,
  workers: 1,
  reporter: "list",
});
