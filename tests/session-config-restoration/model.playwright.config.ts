import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../packages/web-core/src/features/workspace-chat/model',
  testMatch: ['sessionExecutorConfig.test.ts'],
  fullyParallel: true,
  workers: 1,
  reporter: 'list',
});
