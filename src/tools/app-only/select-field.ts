import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Deps } from "../../server/deps.js";
import { registerAppOnlyTool } from "./_helpers.js";

const inputSchema = z
  .object({
    fieldId: z.string().min(1).max(64),
  })
  .strict();

export function registerSelectField(server: McpServer, deps: Deps): void {
  if (!deps.emaff) return;
  const emaff = deps.emaff;
  registerAppOnlyTool(
    server,
    "select_field",
    {
      title: "Load full detail for one farmland polygon",
      description:
        "Return the eMAFF record for a single field ID — used when the user clicks a polygon on the dashboard map. Read-only.",
      inputSchema,
      deps,
    },
    async (args) => {
      const field = await emaff.get(args.fieldId);
      if (!field) {
        return {
          content: [{ type: "text", text: "Field not found." }],
          structuredContent: { found: false },
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `${field.fieldId} · ${(field.areaM2 / 10_000).toFixed(2)} ha · ${field.registeredCrop ?? "no registered crop"}`,
          },
        ],
        structuredContent: { found: true, field },
      };
    },
  );
}
