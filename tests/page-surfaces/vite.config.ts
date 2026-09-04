import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: `${repoRoot}/tests/page-surfaces/fixture`,
  plugins: [react()],
  resolve: {
    alias: {
      '@': `${repoRoot}/packages/web-core/src`,
      react: `${repoRoot}/packages/web-core/node_modules/react`,
      'react-dom': `${repoRoot}/packages/web-core/node_modules/react-dom`,
      '@tanstack/react-query': `${repoRoot}/packages/web-core/node_modules/@tanstack/react-query`,
      '@tanstack/react-router': `${repoRoot}/packages/web-core/node_modules/@tanstack/react-router`,
      'lucide-react': `${repoRoot}/packages/web-core/node_modules/lucide-react`,
      shared: `${repoRoot}/shared`,
    },
  },
  server: { fs: { allow: [repoRoot] } },
});
