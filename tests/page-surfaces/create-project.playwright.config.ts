import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig(base, {
  testDir: "./create-project-fixture",
  testMatch: "create-project.spec.ts",
  outputDir: `${process.cwd()}/test-results/create-project`,
  use: { baseURL: "http://127.0.0.1:4187" },
  webServer: {
    command:
      "pnpm exec vite --host 127.0.0.1 --port 4187 --strictPort --config tests/page-surfaces/create-project.vite.config.ts",
    url: "http://127.0.0.1:4187",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
