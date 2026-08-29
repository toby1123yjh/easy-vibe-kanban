import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: `${repoRoot}/tests/app-shell/fixture`,
  resolve: {
    alias: {
      react: `${repoRoot}/packages/web-core/node_modules/react`,
      'react-dom': `${repoRoot}/packages/web-core/node_modules/react-dom`,
      'lucide-react': `${repoRoot}/packages/web-core/node_modules/lucide-react`,
      shared: `${repoRoot}/shared`,
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
});
