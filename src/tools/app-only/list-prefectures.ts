import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Deps } from "../../server/deps.js";
import { registerAppOnlyTool } from "./_helpers.js";

const inputSchema = z.object({}).strict();

const PREFECTURES: Array<{ code: string; name: string; nameEn: string }> = [
  { code: "JP-46", name: "鹿児島県", nameEn: "Kagoshima" },
  { code: "JP-45", name: "宮崎県", nameEn: "Miyazaki" },
  { code: "JP-43", name: "熊本県", nameEn: "Kumamoto" },
];

export function registerListPrefectures(server: McpServer, _deps: Deps): void {
  registerAppOnlyTool(
    server,
    "list_prefectures",
    {
      title: "List the prefectures present in the current snapshot",
      description: "Static catalogue used by the dashboard's prefecture picker. Read-only.",
      inputSchema,
      deps: _deps,
    },
    async () => {
      return {
        content: [{ type: "text", text: `${PREFECTURES.length} prefectures available.` }],
        structuredContent: { prefectures: PREFECTURES },
      };
    },
  );
}
