import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Deps } from "../../server/deps.js";
import { registerAppOnlyTool } from "./_helpers.js";

const inputSchema = z
  .object({
    minLat: z.number().min(-90).max(90),
    minLng: z.number().min(-180).max(180),
    maxLat: z.number().min(-90).max(90),
    maxLng: z.number().min(-180).max(180),
    limit: z.number().int().min(1).max(500).default(200),
  })
  .strict();

export function registerFetchFieldGeojson(server: McpServer, deps: Deps): void {
  if (!deps.emaff) return;
  const emaff = deps.emaff;
  registerAppOnlyTool(
    server,
    "fetch_field_geojson",
    {
      title: "Fetch farmland polygons (GeoJSON) for the current viewport",
      description:
        "Return up to `limit` eMAFF polygons whose centroid is inside the bounding box. Used by the dashboard map. Read-only.",
      inputSchema,
      deps,
    },
    async (args) => {
      const center = {
        lat: (args.minLat + args.maxLat) / 2,
        lng: (args.minLng + args.maxLng) / 2,
      };
      // Approximate the viewport diagonal as the search radius. Good enough
      // for "give me everything in this map view".
      const result = await emaff.nearby(center, viewportRadiusMeters(args), args.limit);
      return {
        content: [{ type: "text", text: `Loaded ${result.fields.length} field(s).` }],
        structuredContent: {
          type: "FeatureCollection",
          features: result.fields.map((f) => ({
            type: "Feature",
            properties: {
              fieldId: f.fieldId,
              areaM2: f.areaM2,
              registeredCrop: f.registeredCrop,
            },
            geometry: {
              type: "Point",
              coordinates: [f.centroid.lng, f.centroid.lat],
            },
          })),
          attribution: result.attribution,
        },
      };
    },
  );
}

function viewportRadiusMeters(args: {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}): number {
  const dLat = args.maxLat - args.minLat;
  const dLng = args.maxLng - args.minLng;
  // ~111 km per degree of latitude, half-diagonal in metres.
  return Math.min(50_000, Math.ceil(Math.hypot(dLat * 111_000, dLng * 95_000) / 2));
}
