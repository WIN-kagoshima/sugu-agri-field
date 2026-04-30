import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { safeErrorMessage } from "../lib/errors.js";
import { enforceSizeCap } from "../lib/tool-size.js";
import type { Deps } from "../server/deps.js";
import { getToolAnnotations } from "../server/surface-catalog.js";
import type { ToolMeta } from "../types/common.js";
import { FarmlandSearchResultSchema } from "../types/farmland.js";

export const meta: ToolMeta = {
  name: "search_farmland",
  sideEffect: "read-only",
  visibility: "model",
  introducedInPhase: 1,
};

const baseSchema = z
  .object({
    query: z
      .string()
      .max(200)
      .optional()
      .describe(
        "Free-text query: address, place name, postal code, or farm operator name. Optional but at least one of query/prefectureCode/cityCode is required.",
      ),
    prefectureCode: z
      .string()
      .regex(/^JP-\d{2}$/)
      .optional()
      .describe("ISO 3166-2:JP prefecture code, e.g. JP-46 for Kagoshima."),
    cityCode: z
      .string()
      .regex(/^\d{5}$/)
      .optional()
      .describe("Five-digit municipality code."),
    crop: z.string().max(80).optional().describe("Filter by registered crop, e.g. さつまいも."),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
  })
  .strict();

export const inputSchema = baseSchema.refine(
  (v) => Boolean(v.query || v.prefectureCode || v.cityCode || v.crop),
  "Provide at least one of query / prefectureCode / cityCode / crop.",
);

export function registerSearchFarmland(server: McpServer, deps: Deps): void {
  if (!deps.emaff) return;
  const emaff = deps.emaff;
  server.registerTool(
    meta.name,
    {
      title: "Search Japanese farmland",
      description:
        "Search Japanese farmland (eMAFF Fude polygons) by address, prefecture, municipality, or registered crop. " +
        "Read-only. Returns up to 100 polygons per call with a `nextCursor` for pagination.",
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
        const result = await emaff.search(parsed.data);
        const validated = FarmlandSearchResultSchema.parse(result);
        const summary = validated.fields.length
          ? `Found ${validated.fields.length} farmland polygon(s)${
              validated.nextCursor ? " (more available)" : ""
            }.`
          : "No farmland matched.";
        return enforceSizeCap(
          {
            content: [
              { type: "text" as const, text: summary },
              { type: "text" as const, text: validated.attribution },
            ],
            structuredContent: validated as unknown as Record<string, unknown>,
          },
          { toolName: meta.name },
        );
      } catch (err) {
        deps.logger.error("search_farmland failed", { error: (err as Error).message });
        return {
          isError: true,
          content: [{ type: "text", text: safeErrorMessage(err) }],
        };
      }
    },
  );
}
