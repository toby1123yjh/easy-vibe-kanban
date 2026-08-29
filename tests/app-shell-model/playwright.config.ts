import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "../../packages/web-core/src/features/app-shell/model",
  testMatch: ["appShell.test.ts", "search.test.ts"],
  fullyParallel: true,
  workers: 1,
  reporter: "list",
});
