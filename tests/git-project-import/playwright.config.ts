import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './specs',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4206', channel: 'chrome' },
  webServer: {
    command:
      'pnpm exec vite --host 127.0.0.1 --port 4206 --strictPort --config tests/git-project-import/vite.config.ts',
    url: 'http://127.0.0.1:4206',
    reuseExistingServer: false,
  },
});
