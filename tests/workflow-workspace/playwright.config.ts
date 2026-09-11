import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./specs",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:4199", channel: "chrome" },
  webServer: {
    command:
      "pnpm exec vite --host 127.0.0.1 --port 4199 --strictPort --config tests/workflow-workspace/vite.config.ts",
    url: "http://127.0.0.1:4199",
    reuseExistingServer: true,
  },
  reporter: "list",
});
