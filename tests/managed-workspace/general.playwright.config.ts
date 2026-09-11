import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './specs',
  testMatch: 'general.spec.ts',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4205', channel: 'chrome' },
  webServer: {
    command:
      'pnpm exec vite --host 127.0.0.1 --port 4205 --strictPort --config tests/managed-workspace/general.vite.config.ts',
    url: 'http://127.0.0.1:4205/general.html',
    reuseExistingServer: false,
  },
});
