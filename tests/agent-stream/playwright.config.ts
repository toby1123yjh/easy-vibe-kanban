import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4203', channel: 'chrome' },
  webServer: {
    command:
      'pnpm exec vite --host 127.0.0.1 --port 4203 --strictPort --config tests/agent-stream/vite.config.ts',
    url: 'http://127.0.0.1:4203',
    reuseExistingServer: false,
  },
});
