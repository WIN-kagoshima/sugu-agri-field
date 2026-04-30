import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Deps } from "../server/deps.js";

export function registerStaffDeployPlanPrompt(server: McpServer, _deps: Deps): void {
  server.registerPrompt(
    "staff_deploy_plan",
    {
      title: "Draft a staff deployment plan (prompt)",
      description:
        "User-controlled slash command. Drafts a textual deployment plan for a list of farms over a period.",
      argsSchema: {
        farm_ids: z.string().min(1).describe("Comma-separated eMAFF field IDs."),
        period: z
          .string()
          .min(1)
          .describe(
            "Planning period in human form, e.g. '2026年6月の30日間' or '2026-06-01 to 2026-06-30'.",
          ),
      },
    },
    async ({ farm_ids, period }) => {
      const ids = farm_ids
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        description: `Staff deployment plan for ${ids.length} field(s) over ${period}.`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "あなたは農業派遣管理者向けに、特定技能外国人の派遣計画ドラフトを書きます。",
                "",
                "## 対象農地",
                ...ids.map((id) => `- ${id}`),
                "",
                "## 期間",
                `- ${period}`,
                "",
                "計画は **ドラフト** であり、最終確定はマネージャの承認後に行うことを明記してください。",
                "出力は以下の章立て:",
                "1. 想定スタッフ数と1日あたりの工数",
                "2. 想定リスク (天候・移動距離)",
                "3. 補強提案 (追加で確認すべき事項、必要なツール呼び出し)",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}
