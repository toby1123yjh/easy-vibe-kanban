import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const fixtureRoot = `${repoRoot}/tests/onboarding/fixture`;

export default defineConfig({
  root: fixtureRoot,
  plugins: [react()],
  css: { postcss: `${repoRoot}/tests/onboarding` },
  resolve: {
    alias: [
      {
        find: /^@\/shared\/dialogs\/global\/OAuthDialog$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/lib\/api$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/lib\/remoteApi$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/lib\/platform$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/lib\/firstProjectDestination$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^@\/shared\/stores\/useOrganizationStore$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
      {
        find: /^posthog-js\/react$/,
        replacement: `${fixtureRoot}/src/mocks.tsx`,
      },
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
  server: { fs: { allow: [repoRoot] } },
});
