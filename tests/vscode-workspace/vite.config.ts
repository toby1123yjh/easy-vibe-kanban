import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: `${repoRoot}/tests/vscode-workspace/fixture`,
  plugins: [react()],
  css: {
    postcss: `${repoRoot}/tests/vscode-workspace`,
  },
  resolve: {
    alias: {
      '@': `${repoRoot}/packages/web-core/src`,
      '@tanstack/react-query': `${repoRoot}/packages/web-core/node_modules/@tanstack/react-query`,
      '@tanstack/react-router': `${repoRoot}/packages/web-core/node_modules/@tanstack/react-router`,
      react: `${repoRoot}/packages/web-core/node_modules/react`,
      'react-dom': `${repoRoot}/packages/web-core/node_modules/react-dom`,
      'lucide-react': `${repoRoot}/packages/web-core/node_modules/lucide-react`,
      shared: `${repoRoot}/shared`,
    },
  },
  server: { fs: { allow: [repoRoot] } },
});
