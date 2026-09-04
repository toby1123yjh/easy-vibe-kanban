import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { getThemeBootstrapScript } from '../../packages/ui/src/lib/theme';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

function themeBootstrapPlugin(): Plugin {
  return {
    name: 'theme-foundations-bootstrap',
    transformIndexHtml: {
      order: 'pre',
      handler() {
        return [
          {
            tag: 'script',
            children: getThemeBootstrapScript(),
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

export default defineConfig({
  root: `${repoRoot}/tests/ui-foundations/fixture`,
  plugins: [themeBootstrapPlugin()],
  resolve: {
    alias: {
      '@': `${repoRoot}/packages/web-core/src`,
      '@vibe/ui': `${repoRoot}/packages/ui/src`,
      shared: `${repoRoot}/shared`,
      '@tanstack/react-query': `${repoRoot}/packages/web-core/node_modules/@tanstack/react-query`,
      '@tanstack/react-router': `${repoRoot}/packages/web-core/node_modules/@tanstack/react-router`,
      react: `${repoRoot}/packages/ui/node_modules/react`,
      'react-dom': `${repoRoot}/packages/ui/node_modules/react-dom`,
      'lucide-react': `${repoRoot}/packages/ui/node_modules/lucide-react`,
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
});
