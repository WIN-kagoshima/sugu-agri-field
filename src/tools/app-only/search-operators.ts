import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Deps } from "../../server/deps.js";
import { registerAppOnlyTool } from "./_helpers.js";

const inputSchema = z
  .object({
    query: z.string().min(1).max(80),
    limit: z.number().int().min(1).max(50).default(10),
  })
  .strict();

export function registerSearchOperators(server: McpServer, deps: Deps): void {
  if (!deps.emaff) return;
  const emaff = deps.emaff;
  registerAppOnlyTool(
    server,
    "search_operators",
    {
      title: "Autocomplete search for farm operators (legal entities)",
      description:
        "Used by the dashboard's operator search box. Falls through to the eMAFF search filtered by query. Read-only.",
      inputSchema,
      deps,
    },
    async (args) => {
      const result = await emaff.search({
        query: args.query,
        limit: args.limit,
      });
      return {
        content: [{ type: "text", text: `${result.fields.length} match(es).` }],
        structuredContent: {
          fields: result.fields.map((f) => ({
            fieldId: f.fieldId,
            address: f.address,
            registeredCrop: f.registeredCrop,
          })),
          attribution: result.attribution,
        },
      };
    },
  );
}
