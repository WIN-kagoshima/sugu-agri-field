import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Deps } from "../../server/deps.js";
import { registerAppOnlyTool } from "./_helpers.js";

const inputSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    metric: z.enum(["temperature", "precipitation", "wind", "humidity"]).default("temperature"),
    hoursAhead: z.number().int().min(0).max(168).default(0),
  })
  .strict();

export function registerFetchWeatherLayer(server: McpServer, deps: Deps): void {
  registerAppOnlyTool(
    server,
    "fetch_weather_layer",
    {
      title: "Fetch a single weather metric for the dashboard layer",
      description:
        "Returns a single scalar from the Open-Meteo forecast at the given hour offset. Used by the dashboard's weather overlay. Read-only.",
      inputSchema,
      deps,
    },
    async (args) => {
      const forecast = await deps.weather.getForecast({
        lat: args.lat,
        lng: args.lng,
        hours: Math.max(args.hoursAhead + 1, 1),
      });
      const point = forecast.hourly[args.hoursAhead];
      if (!point) {
        return {
          content: [{ type: "text", text: "No forecast point at that offset." }],
          structuredContent: { value: null, attribution: forecast.attribution },
        };
      }
      const value = pickMetric(point, args.metric);
      return {
        content: [{ type: "text", text: `${args.metric}=${value}` }],
        structuredContent: {
          metric: args.metric,
          value,
          time: point.time,
          attribution: forecast.attribution,
        },
      };
    },
  );
}

function pickMetric(
  p: import("../../types/weather.js").HourlyWeather,
  metric: "temperature" | "precipitation" | "wind" | "humidity",
): number {
  switch (metric) {
    case "temperature":
      return p.temperatureC;
    case "precipitation":
      return p.precipitationMm;
    case "wind":
      return p.windSpeedMs;
    case "humidity":
      return p.relativeHumidity;
    default: {
      const exhaustive: never = metric;
      throw new Error(`unsupported metric: ${String(exhaustive)}`);
    }
  }
}
