import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../../packages/web-core/src/features/workflow/model",
  testMatch: "workflowWorkspaceSelection.test.ts",
  workers: 1,
  reporter: "list",
});
