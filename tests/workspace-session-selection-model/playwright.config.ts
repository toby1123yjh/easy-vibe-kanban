import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../packages/web-core/src/shared/hooks',
  testMatch: ['useWorkspaceSessions.test.ts'],
  fullyParallel: true,
  workers: 1,
  reporter: 'list',
});
