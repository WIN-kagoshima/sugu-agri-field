import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { safeErrorMessage } from "../lib/errors.js";
import { enforceSizeCap } from "../lib/tool-size.js";
import type { Deps } from "../server/deps.js";
import { getToolAnnotations } from "../server/surface-catalog.js";
import type { ToolMeta } from "../types/common.js";
import { PesticideQueryResultSchema } from "../types/pesticide.js";

export const meta: ToolMeta = {
  name: "get_pesticide_rules",
  sideEffect: "read-only",
  visibility: "model",
  introducedInPhase: 1,
};

const baseSchema = z
  .object({
    crop: z.string().max(80).optional().describe("Target crop, e.g. さつまいも."),
    pestOrDisease: z
      .string()
      .max(80)
      .optional()
      .describe("Target pest or disease, e.g. アブラムシ類."),
    activeIngredient: z
      .string()
      .max(80)
      .optional()
      .describe("Active ingredient name (Japanese or romaji)."),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
  })
  .strict();

export const inputSchema = baseSchema.refine(
  (v) => Boolean(v.crop || v.pestOrDisease || v.activeIngredient),
  "Provide at least one of crop / pestOrDisease / activeIngredient.",
);

export function registerGetPesticideRules(server: McpServer, deps: Deps): void {
  if (!deps.famic) return;
  const famic = deps.famic;
  server.registerTool(
    meta.name,
    {
      title: "Look up FAMIC pesticide registrations",
      description:
        "Search Japanese pesticide registrations (FAMIC) by crop, pest/disease, or active ingredient. " +
        "Returns registration numbers, products, application limits, and pre-harvest intervals. Read-only.",
      inputSchema: baseSchema.shape,
      annotations: getToolAnnotations(meta.name),
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
        const result = await famic.search(parsed.data);
        const validated = PesticideQueryResultSchema.parse(result);
        const text = validated.rules.length
          ? `${validated.rules.length} pesticide registration(s) found${validated.nextCursor ? " (more available)" : ""}.`
          : "No registrations matched the query.";
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
        deps.logger.error("get_pesticide_rules failed", { error: (err as Error).message });
        return { isError: true, content: [{ type: "text", text: safeErrorMessage(err) }] };
      }
    },
  );
}
