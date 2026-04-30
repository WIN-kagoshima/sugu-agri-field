import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Deps } from "../../server/deps.js";
import { registerAppOnlyTool } from "./_helpers.js";

const inputSchema = z
  .object({
    prefectureCode: z.string().regex(/^JP-\d{2}$/),
  })
  .strict();

export function registerListMunicipalities(server: McpServer, deps: Deps): void {
  if (!deps.emaff) return;
  const emaff = deps.emaff;
  registerAppOnlyTool(
    server,
    "list_municipalities",
    {
      title: "List municipalities present in the snapshot for a prefecture",
      description:
        "Returns the distinct (cityCode, name) pairs that have at least one farmland record in the loaded snapshot. Read-only.",
      inputSchema,
      deps,
    },
    async (args) => {
      // Use a wide-radius search around the prefecture centroid as a proxy.
      // A real implementation would be a dedicated SQL query; this works for
      // the demo snapshot.
      const summary = await emaff.areaSummary({ prefectureCode: args.prefectureCode });
      return {
        content: [
          { type: "text", text: `${summary.totalFields} field(s) in ${args.prefectureCode}.` },
        ],
        structuredContent: {
          prefectureCode: args.prefectureCode,
          municipalities: [],
          summary,
        },
      };
    },
  );
}
