import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixtureRoot = `${repoRoot}/tests/agent-center/fixture`;

export default defineConfig({
  root: fixtureRoot,
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@\/shared\/dialogs\/settings\/settings\/SettingsHostContext$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/dialogs\/settings\/settings\/SettingsDirtyContext$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/dialogs\/settings\/settings\/SettingsMachineUserSystemProvider$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/hooks\/useUserSystem$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/hooks\/useAppRuntime$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/components\/AgentIcon$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/dialogs\/settings\/settings\/AgentConfigurationSettingsPanel$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/dialogs\/settings\/settings\/AgentToolsSettingsSection$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: `${repoRoot}/packages/web-core/src/features/agent-center/AgentCommandsSettingsSection`,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: '@tanstack/react-router',
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: '@vibe/ui/components/StateSurface',
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: '@vibe/ui/components/ConfirmDialog',
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      { find: '@', replacement: `${repoRoot}/packages/web-core/src` },
      { find: 'shared', replacement: `${repoRoot}/shared` },
      {
        find: 'react',
        replacement: `${repoRoot}/packages/web-core/node_modules/react`,
      },
      {
        find: 'react-dom',
        replacement: `${repoRoot}/packages/web-core/node_modules/react-dom`,
      },
      {
        find: '@tanstack/react-query',
        replacement: `${repoRoot}/packages/web-core/node_modules/@tanstack/react-query`,
      },
      {
        find: 'react-i18next',
        replacement: `${repoRoot}/packages/web-core/node_modules/react-i18next`,
      },
      {
        find: '@phosphor-icons/react',
        replacement: `${repoRoot}/packages/web-core/node_modules/@phosphor-icons/react`,
      },
      { find: '@vibe/ui', replacement: `${repoRoot}/packages/ui/src` },
    ],
  },
  server: { fs: { allow: [repoRoot] } },
});
