import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../packages/web-core/src/features/projects/model',
  testMatch: ['project-kanban.test.ts'],
  fullyParallel: true,
  workers: 1,
  reporter: 'list',
});
