import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: `${repoRoot}/tests/workflow/fixture`,
  plugins: [react()],
  resolve: {
    alias: {
      '@': `${repoRoot}/packages/web-core/src`,
      '@xyflow/react': `${repoRoot}/packages/web-core/node_modules/@xyflow/react`,
      'lucide-react': `${repoRoot}/packages/web-core/node_modules/lucide-react`,
      react: `${repoRoot}/packages/web-core/node_modules/react`,
      'react-dom': `${repoRoot}/packages/web-core/node_modules/react-dom`,
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
});
