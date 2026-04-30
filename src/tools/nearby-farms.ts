import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { safeErrorMessage } from "../lib/errors.js";
import { isValidLatLng } from "../lib/geo.js";
import { enforceSizeCap } from "../lib/tool-size.js";
import type { Deps } from "../server/deps.js";
import { getToolAnnotations } from "../server/surface-catalog.js";
import type { ToolMeta } from "../types/common.js";
import { FarmlandSearchResultSchema } from "../types/farmland.js";

export const meta: ToolMeta = {
  name: "nearby_farms",
  sideEffect: "read-only",
  visibility: "model",
  introducedInPhase: 1,
};

export const inputSchema = z
  .object({
    lat: z.number().min(-90).max(90).describe("Latitude of the search centre, WGS84."),
    lng: z.number().min(-180).max(180).describe("Longitude of the search centre, WGS84."),
    radiusMeters: z
      .number()
      .int()
      .min(50)
      .max(20_000)
      .default(2_000)
      .describe("Search radius in metres (50–20,000). Defaults to 2 km."),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();

export function registerNearbyFarms(server: McpServer, deps: Deps): void {
  if (!deps.emaff) return;
  const emaff = deps.emaff;
  server.registerTool(
    meta.name,
    {
      title: "Find farmland near a coordinate",
      description:
        "Return eMAFF farmland polygons whose centroid lies within `radiusMeters` of the given (lat, lng). " +
        "Useful for planning routes between fields and for finding nearby dispatch sites. Read-only.",
      inputSchema: inputSchema.shape,
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
      const args = parsed.data;
      if (!isValidLatLng({ lat: args.lat, lng: args.lng })) {
        return {
          isError: true,
          content: [{ type: "text", text: "Invalid input: lat/lng out of range." }],
        };
      }
      try {
        const result = await emaff.nearby(
          { lat: args.lat, lng: args.lng },
          args.radiusMeters,
          args.limit,
        );
        const validated = FarmlandSearchResultSchema.parse(result);
        const text = validated.fields.length
          ? `${validated.fields.length} farmland polygon(s) within ${args.radiusMeters} m of (${args.lat.toFixed(3)}, ${args.lng.toFixed(3)}).`
          : `No farmland found within ${args.radiusMeters} m.`;
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
        deps.logger.error("nearby_farms failed", { error: (err as Error).message });
        return { isError: true, content: [{ type: "text", text: safeErrorMessage(err) }] };
      }
    },
  );
}
