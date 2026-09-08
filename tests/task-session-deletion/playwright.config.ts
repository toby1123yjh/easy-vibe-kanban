import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  outputDir: '../../test-results/task-session-deletion',
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4198' },
  webServer: {
    command:
      'pnpm exec vite --host 127.0.0.1 --port 4198 --strictPort --config tests/task-session-deletion/vite.config.ts',
    url: 'http://127.0.0.1:4198',
    reuseExistingServer: false,
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
