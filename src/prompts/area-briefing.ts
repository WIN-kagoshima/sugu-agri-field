import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Deps } from "../server/deps.js";

export function registerAreaBriefingPrompt(server: McpServer, deps: Deps): void {
  server.registerPrompt(
    "area_briefing",
    {
      title: "Prefectural agriculture briefing",
      description:
        "User-controlled slash command. Generates a brief prefectural agriculture overview using eMAFF aggregates.",
      argsSchema: {
        prefecture: z
          .string()
          .min(1)
          .describe("Prefecture name (e.g. '鹿児島県') or ISO code (e.g. JP-46)."),
      },
    },
    async ({ prefecture }) => {
      const code = normalisePrefectureCode(prefecture);
      const summary =
        deps.emaff && code
          ? await deps.emaff.areaSummary({ prefectureCode: code }).catch(() => null)
          : null;

      const summaryLines = summary
        ? [
            `- 総農地ポリゴン数: ${summary.totalFields}`,
            `- 総面積: ${summary.totalAreaHa.toFixed(1)} ha`,
            `- 主な登録作物: ${
              summary.topCrops
                .slice(0, 5)
                .map((c) => `${c.crop} (${c.count})`)
                .join("、 ") || "n/a"
            }`,
          ]
        : ["- (eMAFF データ未取得)"];

      return {
        description: `Area briefing for ${prefecture}.`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `あなたは農業派遣管理者向けに、${prefecture} の農業概況ブリーフを書きます。`,
                "",
                "## eMAFF 集計",
                ...summaryLines,
                "",
                `${summary?.attribution ? `出典: ${summary.attribution}` : ""}`,
                "",
                "上記をもとに、派遣需要・季節リスク・想定スタッフ規模の観点から、A4 半ページの簡潔なブリーフを書いてください。",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}

function normalisePrefectureCode(input: string): string | null {
  if (/^JP-\d{2}$/.test(input)) return input;
  // Minimal name → code map. Extend as needed.
  const map: Record<string, string> = {
    鹿児島県: "JP-46",
    宮崎県: "JP-45",
    熊本県: "JP-43",
  };
  return map[input] ?? null;
}
