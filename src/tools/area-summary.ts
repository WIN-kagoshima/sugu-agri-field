import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { safeErrorMessage } from "../lib/errors.js";
import { enforceSizeCap } from "../lib/tool-size.js";
import type { Deps } from "../server/deps.js";
import type { ToolMeta } from "../types/common.js";
import { AreaSummarySchema } from "../types/farmland.js";

export const meta: ToolMeta = {
  name: "area_summary",
  sideEffect: "read-only",
  visibility: "model",
  introducedInPhase: 1,
};

const baseSchema = z
  .object({
    prefectureCode: z
      .string()
      .regex(/^JP-\d{2}$/)
      .optional()
      .describe("ISO 3166-2:JP prefecture code, e.g. JP-46."),
    cityCode: z
      .string()
      .regex(/^\d{5}$/)
      .optional()
      .describe("Five-digit Japanese municipality code."),
  })
  .strict();

export const inputSchema = baseSchema.refine(
  (v) => Boolean(v.prefectureCode || v.cityCode),
  "Provide at least one of prefectureCode / cityCode.",
);

export function registerAreaSummary(server: McpServer, deps: Deps): void {
  if (!deps.emaff) return;
  const emaff = deps.emaff;
  server.registerTool(
    meta.name,
    {
      title: "Farmland summary for an admin area",
      description:
        "Aggregate eMAFF farmland statistics for a prefecture or municipality: total fields, total area in hectares, top registered crops. Read-only.",
      inputSchema: baseSchema.shape,
    },
    async (raw: unknown) => {
      const parsed = inputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid input: ${parsed.error.issues[0]?.message ?? "unknown"}`,
            },
          ],
        };
      }
      try {
        const summary = await emaff.areaSummary(parsed.data);
        const validated = AreaSummarySchema.parse(summary);
        const text = `${validated.totalFields} field(s), ${validated.totalAreaHa.toFixed(1)} ha total. ${
          validated.topCrops.length
            ? `Top crops: ${validated.topCrops
                .slice(0, 3)
                .map((c) => c.crop)
                .join(", ")}.`
            : "No crop registrations on record."
        }`;
        return enforceSizeCap(
          {
            content: [
              { type: "text" as const, text },
              { type: "text" as const, text: validated.attribution },
            ],
            structuredContent: validated as unknown as Record<string, unknown>,
          },
          { toolName: meta.name },
        );
      } catch (err) {
        deps.logger.error("area_summary failed", { error: (err as Error).message });
        return { isError: true, content: [{ type: "text", text: safeErrorMessage(err) }] };
      }
    },
  );
}
