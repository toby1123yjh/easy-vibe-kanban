import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixtureRoot = `${repoRoot}/tests/remote-surfaces/fixture`;

export default defineConfig({
  root: fixtureRoot,
  plugins: [react()],
  server: { port: 4193, fs: { allow: [repoRoot] } },
  resolve: {
    alias: [
      {
        find: /^@remote\/shared\/lib\/api$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@remote\/shared\/lib\/auth$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@remote\/shared\/lib\/pkce$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@remote\/shared\/components\/BrandLogo$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/hooks\/useSettingsNavigation$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/stores\/useOrganizationStore$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/hooks\/useUserOrganizations$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/hooks\/auth\/useAuth$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/hooks\/useIsMobile$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@remote\/shared\/hooks\/useRelayHosts$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@tanstack\/react-router$/,
        replacement: `${fixtureRoot}/src/router-mocks.tsx`,
      },
      { find: '@remote', replacement: `${repoRoot}/packages/remote-web/src` },
      { find: '@', replacement: `${repoRoot}/packages/web-core/src` },
      { find: '@vibe/ui', replacement: `${repoRoot}/packages/ui/src` },
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
        find: 'i18next',
        replacement: `${repoRoot}/packages/web-core/node_modules/i18next`,
      },
      {
        find: '@phosphor-icons/react',
        replacement: `${repoRoot}/packages/web-core/node_modules/@phosphor-icons/react`,
      },
    ],
  },
});
