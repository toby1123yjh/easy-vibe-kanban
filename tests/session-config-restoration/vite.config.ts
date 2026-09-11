import { defineConfig } from 'vite';

const root = process.cwd();
const fixture = `${root}/tests/session-config-restoration/fixture`;

export default defineConfig({
  root: fixture,
  resolve: {
    alias: [
      ...['@/shared/lib/api', '@/shared/providers/HostIdProvider'].map(
        (find) => ({
          find,
          replacement: `${fixture}/mocks.ts`,
        })
      ),
      { find: '@', replacement: `${root}/packages/web-core/src` },
      { find: 'shared', replacement: `${root}/shared` },
      ...['react', 'react-dom', '@tanstack/react-query'].map((find) => ({
        find,
        replacement: `${root}/packages/web-core/node_modules/${find}`,
      })),
    ],
  },
  server: { fs: { allow: [root] } },
});
