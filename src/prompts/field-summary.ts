import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Deps } from "../server/deps.js";

export function registerFieldSummaryPrompt(server: McpServer, deps: Deps): void {
  server.registerPrompt(
    "field_summary",
    {
      title: "Generate a farmland summary",
      description:
        "User-controlled slash command. Produce a 200-character summary of one farmland polygon: area, crop, weather, nearby dispatch sites.",
      argsSchema: {
        field_id: z.string().min(1).max(64).describe("eMAFF Fude polygon ID, e.g. K46-0001-0001."),
      },
    },
    async ({ field_id }) => {
      const adapter = deps.emaff;
      if (!adapter) {
        return {
          description: `Field summary for ${field_id} (eMAFF unavailable).`,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Apologise to the user: the eMAFF adapter is not configured in this build, so a field summary for ${field_id} cannot be produced.`,
              },
            },
          ],
        };
      }

      const field = await adapter.get(field_id);
      if (!field) {
        return {
          description: `Field ${field_id} not found.`,
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: `Apologise to the user: no farmland with ID ${field_id} exists in the current snapshot.`,
              },
            },
          ],
        };
      }

      const weather = await deps.weather
        .getForecast({ lat: field.centroid.lat, lng: field.centroid.lng, hours: 24 })
        .catch(() => null);
      const nearby = await adapter.nearby(field.centroid, 2_000, 5).catch(() => ({
        fields: [],
        attribution: field.attribution,
        nextCursor: null,
      }));

      const weatherLine = weather
        ? `現在気温 ${weather.hourly[0]?.temperatureC?.toFixed(1) ?? "?"}°C, 24h 降水量合計 ${weather.hourly
            .reduce((acc, h) => acc + (h.precipitationMm || 0), 0)
            .toFixed(1)} mm.`
        : "現在の気象は取得できませんでした。";

      return {
        description: `Field summary for ${field_id}.`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "あなたは農業派遣管理者向けに、対象農地の総合サマリ（200字程度の日本語）を作成します。",
                "",
                "## 基本情報",
                `- 筆ポリゴンID: ${field.fieldId}`,
                `- 面積: ${(field.areaM2 / 10_000).toFixed(2)} ha`,
                `- 所在地: ${field.address || "（住所なし）"}`,
                `- 登録作物: ${field.registeredCrop ?? "未登録"}`,
                "",
                "## 気象",
                `- ${weatherLine}`,
                "",
                "## 近隣派遣先 (2 km 以内)",
                ...nearby.fields
                  .slice(0, 5)
                  .map((f) => `- ${f.address || f.fieldId} (${f.registeredCrop ?? "?"})`),
                "",
                `出典: ${field.attribution} / ${weather?.attribution ?? "(weather n/a)"}`,
                "",
                "上記を踏まえ、派遣管理者にとって意思決定に直結する 200 字程度のサマリを作成してください。",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}
