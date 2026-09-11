import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4192" },
  webServer: {
    command:
      "pnpm exec vite --host 127.0.0.1 --port 4192 --strictPort --config tests/session-creation/vite.config.ts",
    url: "http://127.0.0.1:4192",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.CI ? {} : { channel: "chrome" }),
      },
    },
  ],
});
