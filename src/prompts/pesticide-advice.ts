import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Deps } from "../server/deps.js";

export function registerPesticideAdvicePrompt(server: McpServer, deps: Deps): void {
  server.registerPrompt(
    "pesticide_advice",
    {
      title: "Pesticide selection advice",
      description:
        "User-controlled slash command. Suggest registered pesticide options for a (crop, pest_or_disease) pair, citing FAMIC registrations.",
      argsSchema: {
        crop: z.string().min(1).max(80).describe("対象作物 (e.g. さつまいも)."),
        pest_or_disease: z.string().min(1).max(80).describe("対象病害虫名 (e.g. アブラムシ類)."),
      },
    },
    async ({ crop, pest_or_disease }) => {
      const famic = deps.famic;
      const rules = famic
        ? await famic
            .search({ crop, pestOrDisease: pest_or_disease, limit: 8 })
            .catch(() => ({ rules: [], nextCursor: null, attribution: "FAMIC" }))
        : { rules: [], nextCursor: null, attribution: "FAMIC" };

      const rulesLines = rules.rules.length
        ? rules.rules
            .map(
              (r) =>
                `- 登録番号 ${r.registrationId}: ${r.productName}（収穫前日数 ${r.preHarvestIntervalDays ?? "?"}日, 最大適用回数 ${r.maxApplicationsPerSeason ?? "?"}回）`,
            )
            .join("\n")
        : "- (FAMIC アダプタ未設定または該当登録なし)";

      return {
        description: `Pesticide advice for ${crop} × ${pest_or_disease}.`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `あなたは農業従事者向けに、${crop}に発生した「${pest_or_disease}」への農薬選定アドバイスを書きます。`,
                "",
                "## 候補登録",
                rulesLines,
                "",
                `出典: ${rules.attribution}`,
                "",
                "上記を踏まえ、現場担当者が次の判断を下せるレベルの 5 つ以内の選択肢と注意点（収穫前日数・最大適用回数の遵守、ローテーション、影響範囲）を簡潔にまとめてください。最終決定は必ず登録情報の最新版で確認するよう促してください。",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}
