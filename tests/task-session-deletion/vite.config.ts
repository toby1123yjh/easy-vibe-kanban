import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = process.cwd();
const fixture = `${root}/tests/task-session-deletion/fixture`;
export default defineConfig({
  root: fixture,
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^\.\/(localApiTransport|remoteApi)$/,
        replacement: `${fixture}/transport.ts`,
      },
      ...['@/shared/lib/localApiTransport', '@/shared/lib/remoteApi'].map(
        (find) => ({
          find,
          replacement: `${fixture}/transport.ts`,
        })
      ),
      { find: '@', replacement: `${root}/packages/web-core/src` },
      { find: '@vibe/ui', replacement: `${root}/packages/ui/src` },
      { find: 'shared', replacement: `${root}/shared` },
      ...[
        'react',
        'react-dom',
        '@tanstack/react-query',
        '@ebay/nice-modal-react',
      ].map((find) => ({
        find,
        replacement: `${root}/packages/web-core/node_modules/${find}`,
      })),
    ],
  },
  server: { fs: { allow: [root] } },
});
