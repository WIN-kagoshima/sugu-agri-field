import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Deps } from "../../server/deps.js";
import { registerAppOnlyTool } from "./_helpers.js";

const inputSchema = z
  .object({
    fieldIds: z.array(z.string().min(1).max(64)).min(1).max(50),
  })
  .strict();

export function registerSummarizeFarmland(server: McpServer, deps: Deps): void {
  if (!deps.emaff) return;
  const emaff = deps.emaff;
  registerAppOnlyTool(
    server,
    "summarize_farmland",
    {
      title: "Summarize a set of farmland polygons",
      description: "Aggregate area and crop counts across the requested field IDs. Read-only.",
      inputSchema,
      deps,
    },
    async (args) => {
      const fields = await Promise.all(args.fieldIds.map((id) => emaff.get(id)));
      const present = fields.filter((f): f is NonNullable<typeof f> => f !== null);
      const totalAreaHa = present.reduce((acc, f) => acc + f.areaM2 / 10_000, 0);
      const cropCounts = new Map<string, number>();
      for (const f of present) {
        const k = f.registeredCrop ?? "(unregistered)";
        cropCounts.set(k, (cropCounts.get(k) ?? 0) + 1);
      }
      return {
        content: [
          {
            type: "text",
            text: `${present.length}/${args.fieldIds.length} field(s) found, total ${totalAreaHa.toFixed(2)} ha.`,
          },
        ],
        structuredContent: {
          fieldCount: present.length,
          missing: args.fieldIds.length - present.length,
          totalAreaHa,
          cropCounts: Array.from(cropCounts.entries()).map(([crop, count]) => ({ crop, count })),
        },
      };
    },
  );
}
