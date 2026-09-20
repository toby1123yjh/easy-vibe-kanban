import { defineConfig, devices } from '@playwright/test';

const port = 4236;

export default defineConfig({
  testDir: './specs',
  outputDir: `${process.cwd()}/test-results/route-transition`,
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'on-first-retry' },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort --config tests/route-transition/vite.config.ts`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
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
