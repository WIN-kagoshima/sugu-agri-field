import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Deps } from "../../server/deps.js";
import { registerAppOnlyTool } from "./_helpers.js";

const inputSchema = z
  .object({
    fieldId: z.string().min(1).max(64),
  })
  .strict();

/**
 * Phase 6 will provide a real Sentinel-2 NDVI tool gated by a Tasks
 * primitive (long-running). This Phase 5 stub returns a deterministic
 * placeholder so the dashboard can wire up the UI now without network
 * dependencies. The structured output explicitly flags `placeholder: true`.
 */
export function registerComputeNdviStub(server: McpServer, deps: Deps): void {
  if (!deps.emaff) return;
  const emaff = deps.emaff;
  registerAppOnlyTool(
    server,
    "compute_ndvi_stub",
    {
      title: "Compute NDVI for a field (stub)",
      description:
        "Phase 5 placeholder. Returns a deterministic NDVI value derived from the field ID hash. Phase 6 will replace this with a real Sentinel-2 pipeline gated by a Tasks primitive.",
      inputSchema,
      deps,
    },
    async (args) => {
      const field = await emaff.get(args.fieldId);
      if (!field) {
        return {
          content: [{ type: "text", text: "Field not found." }],
          structuredContent: { found: false, placeholder: true },
        };
      }
      const ndvi = pseudoNdvi(args.fieldId);
      return {
        content: [{ type: "text", text: `NDVI ≈ ${ndvi.toFixed(2)} (placeholder).` }],
        structuredContent: {
          found: true,
          placeholder: true,
          fieldId: args.fieldId,
          ndvi,
          note: "Replace with real Sentinel-2 pipeline in Phase 6 (Tasks primitive).",
        },
      };
    },
  );
}

function pseudoNdvi(seed: string): number {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return 0.2 + (hash % 600) / 1_000;
}
