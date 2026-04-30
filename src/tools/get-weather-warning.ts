import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { JmaWarning } from "../adapters/_interface.js";
import { safeErrorMessage } from "../lib/errors.js";
import type { Deps } from "../server/deps.js";
import type { ToolMeta } from "../types/common.js";

export const meta: ToolMeta = {
  name: "get_weather_warning",
  sideEffect: "read-only",
  visibility: "model",
  introducedInPhase: 1,
};

export const inputSchema = z
  .object({
    prefectureCode: z
      .string()
      .regex(/^JP-\d{2}$/)
      .optional()
      .describe(
        "ISO 3166-2:JP prefecture code (e.g. `JP-46` for 鹿児島県). Omit for nationwide listing.",
      ),
    severityAtLeast: z
      .enum(["info", "advisory", "warning", "tokubetsu"])
      .default("advisory")
      .describe(
        "Minimum severity to include. `tokubetsu` is the highest (大雨特別警報 etc.). Default `advisory` skips pure information bulletins.",
      ),
    limit: z.number().int().min(1).max(100).default(20).describe("Max records to return."),
  })
  .strict();

const SEVERITY_RANK: Record<JmaWarning["severity"], number> = {
  info: 0,
  advisory: 1,
  warning: 2,
  tokubetsu: 3,
};

export function registerGetWeatherWarning(server: McpServer, deps: Deps): void {
  if (!deps.jma) return;
  const jma = deps.jma;
  server.registerTool(
    meta.name,
    {
      title: "JMA active weather warnings & advisories",
      description:
        "Returns active 警報・注意報 (warnings/advisories) issued by JMA (気象庁) for the given prefecture, " +
        "filtered to the requested severity floor. Source: official JMA Disaster XML feed under the " +
        "Japan Meteorological Business Act (気象業務法). Cache TTL is capped at 10 minutes; do not " +
        "treat the result as real-time. The `attribution` string MUST be cited when surfacing data to " +
        "end users. Read-only.",
      inputSchema: inputSchema.shape,
    },
    async (raw: unknown) => {
      const parsed = inputSchema.safeParse(raw);
      if (!parsed.success) {
        const reason = parsed.error.issues[0]?.message ?? "invalid input";
        return {
          isError: true,
          content: [{ type: "text", text: `Invalid input: ${reason}` }],
        };
      }
      const args = parsed.data;

      try {
        const result = await jma.getActiveWarnings({
          prefectureCode: args.prefectureCode,
        });
        const minRank = SEVERITY_RANK[args.severityAtLeast];
        const filtered = result.warnings
          .filter((w) => SEVERITY_RANK[w.severity] >= minRank)
          .slice(0, args.limit);
        const summary = summarise(filtered, args.prefectureCode);
        return {
          content: [
            { type: "text", text: summary },
            { type: "text", text: result.attribution },
          ],
          structuredContent: {
            warnings: filtered,
            fetchedAt: result.fetchedAt,
            attribution: result.attribution,
            count: filtered.length,
          } as unknown as Record<string, unknown>,
        };
      } catch (err) {
        deps.logger.error("get_weather_warning failed", {
          error: (err as Error).message,
          prefectureCode: args.prefectureCode,
        });
        return {
          isError: true,
          content: [{ type: "text", text: safeErrorMessage(err) }],
        };
      }
    },
  );
}

function summarise(warnings: JmaWarning[], prefectureCode: string | undefined): string {
  if (warnings.length === 0) {
    return prefectureCode
      ? `No active warnings or advisories for ${prefectureCode}.`
      : "No active warnings or advisories.";
  }
  const lines = [
    `${warnings.length} active warning(s)/advisory(ies)${prefectureCode ? ` for ${prefectureCode}` : ""}:`,
    ...warnings
      .slice(0, 10)
      .map((w) => `- [${w.severity}] ${w.kind} — ${w.areaName} (issued ${w.issuedAt})`),
  ];
  if (warnings.length > 10) {
    lines.push(`(+${warnings.length - 10} more)`);
  }
  return lines.join("\n");
}
