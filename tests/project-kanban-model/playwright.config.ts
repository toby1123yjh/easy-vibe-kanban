import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../packages/web-core/src',
  testMatch: ['**/project-kanban.test.ts', '**/taskShapeDecoder.test.ts'],
  fullyParallel: true,
  workers: 1,
  reporter: 'list',
});
