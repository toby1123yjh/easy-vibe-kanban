import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../packages/web-core/src/features/utility/model',
  testMatch: ['utilityState.test.ts'],
  fullyParallel: true,
  workers: 1,
  reporter: 'list',
});
