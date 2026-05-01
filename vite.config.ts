import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * Vite configuration for the MCP Apps UI dashboard.
 *
 * Output: a single self-contained `dist/ui/dashboard.html` (CSS, JS, and
 * fonts inlined) so the file can be served verbatim from the
 * `ui://agriops/dashboard.html` MCP resource.
 *
 * Constraints:
 *  - No external CDN refs (would be blocked by MCP Apps host CSP).
 *  - No service workers, no eval, no top-level await (older sandbox UAs).
 */
export default defineConfig({
  root: "src/ui",
  base: "./",
  plugins: [
    react(),
    viteSingleFile({
      removeViteModuleLoader: true,
    }),
  ],
  build: {
    outDir: "../../dist/ui",
    emptyOutDir: true,
    target: "es2022",
    cssCodeSplit: false,
    assetsInlineLimit: 16 * 1024 * 1024,
    rollupOptions: {
      input: "src/ui/index.html",
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});
