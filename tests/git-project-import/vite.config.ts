import { defineConfig } from 'vite';
import base from '../page-surfaces/vite.config';
const root = process.cwd();
const fixture = `${root}/tests/git-project-import/fixture`;
export default defineConfig({
  ...base,
  root: fixture,
  resolve: {
    alias: [
      ...[
        '@/shared/integrations/electric/hooks',
        '@/shared/dialogs/settings/settings/SettingsHostContext',
        '@/shared/dialogs/shared/WorkspaceTargetDialog',
        '@/shared/hooks/useProjectRepoDefaults',
        '@/shared/providers/HostIdProvider',
      ].map((find) => ({ find, replacement: `${fixture}/mocks.tsx` })),
      { find: '@vibe/ui', replacement: `${root}/packages/ui/src` },
      ...Object.entries(base.resolve!.alias!).map(([find, replacement]) => ({
        find,
        replacement: String(replacement),
      })),
    ],
  },
});
