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
