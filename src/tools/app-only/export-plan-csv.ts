import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Deps } from "../../server/deps.js";
import { registerAppOnlyTool } from "./_helpers.js";

const inputSchema = z
  .object({
    rows: z
      .array(
        z.object({
          fieldId: z.string(),
          dispatchDate: z.string(),
          staffCount: z.number().int().min(0),
        }),
      )
      .min(1)
      .max(2_000),
  })
  .strict();

export function registerExportPlanCsv(server: McpServer, deps: Deps): void {
  registerAppOnlyTool(
    server,
    "export_plan_csv",
    {
      title: "Export the deployment plan as CSV",
      description:
        "Returns a CSV string of the plan rows. The dashboard uses it to drive a download link. Pure transformation — no side effects.",
      inputSchema,
      deps,
    },
    async (args) => {
      const header = "fieldId,dispatchDate,staffCount";
      const body = args.rows
        .map((r) => `${csv(r.fieldId)},${csv(r.dispatchDate)},${r.staffCount}`)
        .join("\n");
      const csvText = `${header}\n${body}\n`;
      return {
        content: [{ type: "text", text: `Generated CSV with ${args.rows.length} row(s).` }],
        structuredContent: { csv: csvText, rowCount: args.rows.length },
      };
    },
  );
}

function csv(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
