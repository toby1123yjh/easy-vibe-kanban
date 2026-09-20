import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: `${repoRoot}/tests/route-transition/fixture`,
  plugins: [react()],
  resolve: {
    alias: {
      '@': `${repoRoot}/packages/web-core/src`,
      react: `${repoRoot}/packages/web-core/node_modules/react`,
      'react-dom': `${repoRoot}/packages/web-core/node_modules/react-dom`,
      '@tanstack/react-router': `${repoRoot}/packages/web-core/node_modules/@tanstack/react-router`,
      shared: `${repoRoot}/shared`,
    },
  },
  server: { fs: { allow: [repoRoot] } },
});
