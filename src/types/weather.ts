import { z } from "zod";

export const HourlyWeatherSchema = z.object({
  time: z.string().describe("ISO 8601 timestamp with timezone."),
  temperatureC: z.number().describe("Air temperature, °C."),
  precipitationMm: z.number().min(0).describe("Precipitation, mm, over the previous hour."),
  windSpeedMs: z.number().min(0).describe("Wind speed at 10 m, m/s."),
  relativeHumidity: z.number().min(0).max(100).describe("Relative humidity, %."),
});

export type HourlyWeather = z.infer<typeof HourlyWeatherSchema>;

export const WeatherForecastSchema = z.object({
  source: z.string().describe("Provider identifier, e.g. open-meteo."),
  attribution: z
    .string()
    .describe("License attribution string the LLM should quote when surfacing this data."),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
    timezone: z.string(),
    elevationM: z.number().optional(),
  }),
  generatedAt: z.string().describe("Server-side timestamp when the forecast was retrieved."),
  hourly: z.array(HourlyWeatherSchema).max(168), // 7 days * 24 h
  alerts: z
    .array(
      z.object({
        kind: z.string(),
        severity: z.enum(["info", "advisory", "warning", "emergency"]),
        message: z.string(),
        issuedAt: z.string().optional(),
      }),
    )
    .default([]),
});

export type WeatherForecast = z.infer<typeof WeatherForecastSchema>;
