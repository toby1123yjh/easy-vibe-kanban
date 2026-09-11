import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import base from "./vite.config";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  ...base,
  publicDir: `${repoRoot}/packages/public`,
  css: { postcss: `${repoRoot}/packages/local-web` },
});
