import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Deps } from "../server/deps.js";

export function registerWeatherRiskAlertPrompt(server: McpServer, deps: Deps): void {
  server.registerPrompt(
    "weather_risk_alert",
    {
      title: "1-week weather risk alert",
      description:
        "User-controlled slash command. Inspects forecasts for the given farms and lists fields whose 7-day weather looks risky.",
      argsSchema: {
        farm_ids: z.string().min(1).describe("Comma-separated eMAFF field IDs (max 20)."),
      },
    },
    async ({ farm_ids }) => {
      const adapter = deps.emaff;
      const ids = farm_ids
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);

      if (!adapter || ids.length === 0) {
        return {
          description: "Weather risk alert (insufficient input).",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: "対象農地が指定されていない、または eMAFF アダプタが未設定です。ユーザーに farm_ids を確認するか、サーバ管理者にデータ取込を依頼してください。",
              },
            },
          ],
        };
      }

      const fields = await Promise.all(ids.map((id) => adapter.get(id)));
      const present = fields.filter((f): f is NonNullable<typeof f> => f !== null);
      const forecasts = await Promise.all(
        present.map(async (f) => {
          const fc = await deps.weather
            .getForecast({ lat: f.centroid.lat, lng: f.centroid.lng, hours: 168 })
            .catch(() => null);
          return { field: f, forecast: fc };
        }),
      );

      const lines = forecasts.map(({ field, forecast }) => {
        if (!forecast) return `- ${field.fieldId}: 予報取得失敗`;
        const totalRain = forecast.hourly.reduce((acc, h) => acc + (h.precipitationMm || 0), 0);
        const peakWind = Math.max(0, ...forecast.hourly.map((h) => h.windSpeedMs || 0));
        return `- ${field.fieldId}: 7日合計降水量 ${totalRain.toFixed(1)} mm, 最大風速 ${peakWind.toFixed(1)} m/s`;
      });

      return {
        description: `Weather risk alert for ${present.length} field(s).`,
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "あなたは農業派遣管理者向けに、対象農地の 1 週間先までの気象リスクを評価します。",
                "",
                "## 1 週間予報のサマリ",
                ...lines,
                "",
                `出典: ${forecasts[0]?.forecast?.attribution ?? "(weather n/a)"}`,
                "",
                "降水量 50 mm 超、最大風速 10 m/s 超のいずれかを満たす農地を ⚠️ で強調し、現場で取るべき具体策（作業順序の入れ替え、待機判断）を 3 行以内で示してください。",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}
