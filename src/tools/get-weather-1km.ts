import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ValidationError, safeErrorMessage } from "../lib/errors.js";
import { isValidLatLng } from "../lib/geo.js";
import type { Deps } from "../server/deps.js";
import { getToolAnnotations } from "../server/surface-catalog.js";
import type { ToolMeta } from "../types/common.js";
import { WeatherForecastSchema } from "../types/weather.js";

export const meta: ToolMeta = {
  name: "get_weather_1km",
  sideEffect: "read-only",
  visibility: "model",
  introducedInPhase: 0,
};

/**
 * Input schema. Kept narrow on purpose: the LLM is expected to resolve a
 * place name to lat/lng using its world knowledge (or an upstream tool),
 * then call this tool with coordinates.
 */
export const inputSchema = z
  .object({
    lat: z.number().min(-90).max(90).describe("Latitude in decimal degrees, WGS84. -90 to 90."),
    lng: z
      .number()
      .min(-180)
      .max(180)
      .describe("Longitude in decimal degrees, WGS84. -180 to 180."),
    hours: z
      .number()
      .int()
      .min(1)
      .max(168)
      .default(24)
      .describe("Number of forecast hours to return (1–168, i.e. up to 7 days)."),
    timezone: z
      .string()
      .default("Asia/Tokyo")
      .describe("IANA timezone name. Defaults to Asia/Tokyo for Japanese fields."),
  })
  .strict();

export type WeatherInput = z.infer<typeof inputSchema>;

export function registerGetWeather1km(server: McpServer, deps: Deps): void {
  server.registerTool(
    meta.name,
    {
      title: "Get 1 km mesh weather forecast",
      description:
        "Returns an hourly weather forecast for the given (lat, lng). Phase 0 uses Open-Meteo (free, CC-BY 4.0). " +
        "The result includes temperature, precipitation, wind, and relative humidity for up to 168 hours, " +
        "plus an `attribution` string that MUST be quoted when surfacing the data to end users. " +
        "Read-only and idempotent; safe to retry.",
      inputSchema: inputSchema.shape,
      annotations: getToolAnnotations(meta.name),
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
      if (!isValidLatLng({ lat: args.lat, lng: args.lng })) {
        return {
          isError: true,
          content: [{ type: "text", text: "Invalid input: lat/lng out of range." }],
        };
      }

      try {
        const forecast = await deps.weather.getForecast({
          lat: args.lat,
          lng: args.lng,
          hours: args.hours,
          timezone: args.timezone,
        });
        const validated = WeatherForecastSchema.parse(forecast);
        const summary = summarise(validated);
        return {
          content: [
            { type: "text", text: summary },
            { type: "text", text: validated.attribution },
          ],
          structuredContent: validated as unknown as Record<string, unknown>,
        };
      } catch (err) {
        if (err instanceof ValidationError) {
          return {
            isError: true,
            content: [{ type: "text", text: safeErrorMessage(err) }],
          };
        }
        deps.logger.error("get_weather_1km failed", {
          error: (err as Error).message,
          lat: args.lat,
          lng: args.lng,
        });
        return {
          isError: true,
          content: [{ type: "text", text: safeErrorMessage(err) }],
        };
      }
    },
  );
}

function summarise(f: import("../types/weather.js").WeatherForecast): string {
  const first = f.hourly[0];
  const last = f.hourly[f.hourly.length - 1];
  if (!first || !last) {
    return `No hourly forecast points returned for (${f.location.lat.toFixed(3)}, ${f.location.lng.toFixed(3)}).`;
  }
  const temps = f.hourly.map((h) => h.temperatureC).filter((t) => Number.isFinite(t));
  const minT = temps.length ? Math.min(...temps).toFixed(1) : "?";
  const maxT = temps.length ? Math.max(...temps).toFixed(1) : "?";
  const totalRain = f.hourly.reduce((acc, h) => acc + (h.precipitationMm || 0), 0).toFixed(1);
  return [
    `Forecast for (${f.location.lat.toFixed(3)}, ${f.location.lng.toFixed(3)}, tz=${f.location.timezone}),`,
    `${f.hourly.length} hourly points from ${first.time} to ${last.time}.`,
    `Range: ${minT}°C to ${maxT}°C, total precipitation ${totalRain} mm.`,
  ].join(" ");
}
