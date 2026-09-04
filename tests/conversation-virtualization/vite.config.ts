import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const sourceRoot = process.env.VK_SOURCE_ROOT
  ? path.resolve(repoRoot, process.env.VK_SOURCE_ROOT)
  : repoRoot;

export default defineConfig({
  root: `${repoRoot}/tests/conversation-virtualization/fixture`,
  resolve: {
    alias: {
      '@': `${sourceRoot}/packages/web-core/src`,
      '@web-core': `${sourceRoot}/packages/web-core/src`,
      '@ui': `${sourceRoot}/packages/ui/src`,
      react: `${repoRoot}/packages/web-core/node_modules/react`,
      'react-dom': `${repoRoot}/packages/web-core/node_modules/react-dom`,
      shared: `${sourceRoot}/shared`,
    },
  },
  server: { fs: { allow: [repoRoot] } },
});
