import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../packages/web-core/src',
  testMatch: [
    'features/onboarding/model/authMethodDiscoveryState.test.ts',
    'features/projects/model/projectBoardAccessState.test.ts',
    'features/projects/model/projectDirectoryState.test.ts',
    'shared/lib/workspaceDetailState.test.ts',
  ],
  fullyParallel: true,
  workers: 1,
  reporter: 'list',
});
