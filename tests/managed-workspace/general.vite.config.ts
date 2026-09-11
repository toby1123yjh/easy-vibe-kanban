import { defineConfig } from 'vite';

const root = process.cwd();
const fixture = `${root}/tests/managed-workspace/fixture`;
export default defineConfig({
  root: fixture,
  optimizeDeps: { entries: ['general.html'] },
  resolve: {
    alias: [
      ...[
        /^\.\/SettingsHostContext$/,
        /^\.\/SettingsMachineUserSystemProvider$/,
        /^\.\/SettingsDirtyContext$/,
        '@/shared/hooks/useTheme',
        '@/shared/hooks/useIsMobile',
        '@/shared/components/TagManager',
        '@/shared/dialogs/shared/FolderPickerDialog',
      ].map((find) => ({ find, replacement: `${fixture}/general-mocks.tsx` })),
      { find: 'react-i18next', replacement: `${fixture}/mocks.tsx` },
      { find: '@', replacement: `${root}/packages/web-core/src` },
      { find: 'shared', replacement: `${root}/shared` },
      { find: '@vibe/ui', replacement: `${root}/packages/ui/src` },
      ...[
        'react',
        'react-dom',
        '@tanstack/react-query',
        '@phosphor-icons/react',
      ].map((find) => ({
        find,
        replacement: `${root}/packages/web-core/node_modules/${find}`,
      })),
    ],
  },
  server: { fs: { allow: [root] } },
});
