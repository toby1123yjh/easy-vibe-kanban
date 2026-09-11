import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  outputDir: '../../test-results/session-config-restoration',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4197' },
  webServer: {
    command:
      'pnpm exec vite --host 127.0.0.1 --port 4197 --strictPort --config tests/session-config-restoration/vite.config.ts',
    url: 'http://127.0.0.1:4197',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.CI ? {} : { channel: 'chrome' }),
      },
    },
  ],
});
