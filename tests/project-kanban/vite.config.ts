import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  root: `${repoRoot}/tests/project-kanban/fixture`,
  plugins: [react()],
  resolve: {
    alias: {
      "@": `${repoRoot}/packages/web-core/src`,
      react: `${repoRoot}/packages/web-core/node_modules/react`,
      "react-dom": `${repoRoot}/packages/web-core/node_modules/react-dom`,
      "lucide-react": `${repoRoot}/packages/web-core/node_modules/lucide-react`,
      shared: `${repoRoot}/shared`,
    },
  },
  server: { fs: { allow: [repoRoot] } },
});
