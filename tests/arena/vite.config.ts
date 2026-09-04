import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const requireFromLocalWeb = createRequire(
  new URL('../../packages/local-web/package.json', import.meta.url)
);
const autoprefixer = requireFromLocalWeb('autoprefixer');
const tailwindcss = requireFromLocalWeb('tailwindcss');
const loadTailwindConfig = requireFromLocalWeb('tailwindcss/loadConfig');
const tailwindConfig = loadTailwindConfig(
  `${repoRoot}/packages/local-web/tailwind.new.config.js`
);

export default defineConfig({
  root: `${repoRoot}/tests/arena/fixture`,
  plugins: [react()],
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          ...tailwindConfig,
          content: [
            `${repoRoot}/packages/web-core/src/**/*.{ts,tsx}`,
            `${repoRoot}/packages/ui/src/**/*.{ts,tsx}`,
            `${repoRoot}/tests/arena/fixture/src/**/*.{ts,tsx}`,
          ],
        }),
        autoprefixer(),
      ],
    },
  },
  resolve: {
    alias: {
      '@': `${repoRoot}/packages/web-core/src`,
      '@tanstack/react-query': `${repoRoot}/packages/web-core/node_modules/@tanstack/react-query`,
      react: `${repoRoot}/packages/web-core/node_modules/react`,
      'react-dom': `${repoRoot}/packages/web-core/node_modules/react-dom`,
      'lucide-react': `${repoRoot}/packages/web-core/node_modules/lucide-react`,
      shared: `${repoRoot}/shared`,
    },
  },
  server: { fs: { allow: [repoRoot] } },
});
