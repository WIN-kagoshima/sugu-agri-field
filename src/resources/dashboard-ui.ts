import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../server/deps.js";
import { DASHBOARD_URI } from "../tools/open-dashboard.js";

/**
 * Register the MCP Apps UI resource at `ui://agriops/dashboard.html`.
 *
 * The HTML is produced by `npm run build:ui` (Vite + vite-plugin-singlefile)
 * into `dist/ui/dashboard.html`. If the bundle is missing (e.g. the user is
 * running stdio in dev without having built the UI yet) we serve a tiny
 * placeholder page so the resource still exists, and the LLM can explain
 * to the user that the UI bundle is not ready.
 */
export function registerDashboardUiResource(server: McpServer, deps: Deps): void {
  server.registerResource(
    "agriops-dashboard",
    DASHBOARD_URI,
    {
      title: "AgriOps MCP map dashboard",
      description: "Single-file React + MapLibre GL UI bundle. Rendered inline by MCP Apps hosts.",
      mimeType: "text/html",
    },
    async () => {
      const html = await loadHtml(deps);
      return {
        contents: [
          {
            uri: DASHBOARD_URI,
            mimeType: "text/html",
            text: html,
          },
        ],
      };
    },
  );
}

let cached: string | null = null;

async function loadHtml(deps: Deps): Promise<string> {
  if (cached) return cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "..", "..", "ui", "dashboard.html"), // dist/ui/dashboard.html (post build)
    resolve(here, "..", "..", "..", "dist", "ui", "dashboard.html"),
    resolve(process.cwd(), "dist", "ui", "dashboard.html"),
    // Vite's default output filename is index.html — accept it too so a
    // fresh `vite build` can be served without a rename step.
    resolve(here, "..", "..", "ui", "index.html"),
    resolve(here, "..", "..", "..", "dist", "ui", "index.html"),
    resolve(process.cwd(), "dist", "ui", "index.html"),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      const html = await readFile(path, "utf-8");
      cached = html;
      return html;
    }
  }
  deps.logger.warn("dashboard UI bundle not found — serving placeholder", {
    triedPaths: candidates,
  });
  cached = placeholderHtml();
  return cached;
}

function placeholderHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AgriOps MCP — UI not built</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; padding: 2rem; max-width: 40rem; margin: 0 auto; color: #222; }
    code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 4px; }
    .note { color: #555; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>AgriOps MCP dashboard</h1>
  <p>The interactive UI has not been built yet. Run:</p>
  <pre><code>npm run build:ui</code></pre>
  <p class="note">This placeholder is served when <code>dist/ui/dashboard.html</code> does not exist on the server filesystem.</p>
</body>
</html>`;
}
