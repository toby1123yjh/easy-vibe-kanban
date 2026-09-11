import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
const root = fileURLToPath(new URL("../..", import.meta.url));
const modules = `${root}/packages/web-core/node_modules`;
const context = `${root}/tests/workflow-workspace/fixture/src/context.ts`;
export default defineConfig({
  root: `${root}/tests/workflow-workspace/fixture`,
  plugins: [react()],
  resolve: {
    alias: {
      "@/shared/hooks/useUserContext": context,
      "@/shared/hooks/useWorkspaceContext": context,
      "@/shared/hooks/useCurrentKanbanRouteState": context,
      "@": `${root}/packages/web-core/src`,
      react: `${modules}/react`,
      "react-dom": `${modules}/react-dom`,
      "@ebay/nice-modal-react": `${modules}/@ebay/nice-modal-react`,
      "react-hotkeys-hook": `${modules}/react-hotkeys-hook`,
      "@tanstack/react-query": `${modules}/@tanstack/react-query`,
      shared: `${root}/shared`,
    },
  },
  server: { fs: { allow: [root] } },
});
