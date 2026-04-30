import { TtlCache } from "../../lib/cache.js";
import { UpstreamError, ValidationError } from "../../lib/errors.js";
import { isValidLatLng } from "../../lib/geo.js";
import type { Logger } from "../../lib/logger.js";
import type { WeatherForecast } from "../../types/weather.js";
import type { WeatherAdapter } from "../_interface.js";

const DEFAULT_BASE_URL = "https://api.open-meteo.com/v1";
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const ATTRIBUTION = "Weather data by Open-Meteo.com (CC-BY 4.0). https://open-meteo.com/";

/**
 * Open-Meteo response shape — only the fields we actually consume.
 * The full spec is at https://open-meteo.com/en/docs.
 */
interface OpenMeteoForecastResponse {
  latitude: number;
  longitude: number;
  timezone: string;
  elevation?: number;
  hourly?: {
    time: string[];
    temperature_2m: number[];
    precipitation: number[];
    wind_speed_10m: number[];
    relative_humidity_2m: number[];
  };
}

export interface OpenMeteoOptions {
  baseUrl?: string;
  cacheTtlMs?: number;
  logger?: Logger;
  /** Injected fetch — replace in tests with MSW or a fake. */
  fetchImpl?: typeof fetch;
}

/**
 * No API key. Free for non-commercial **and** commercial use under CC-BY 4.0
 * provided the attribution string is preserved. We attach the attribution
 * to every result so the LLM can quote it when surfacing the data.
 */
export class OpenMeteoWeatherAdapter implements WeatherAdapter {
  private readonly baseUrl: string;
  private readonly cache: TtlCache<string, WeatherForecast>;
  private readonly logger: Logger | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenMeteoOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.cache = new TtlCache<string, WeatherForecast>(options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async getForecast(input: {
    lat: number;
    lng: number;
    hours: number;
    timezone?: string;
  }): Promise<WeatherForecast> {
    if (!isValidLatLng({ lat: input.lat, lng: input.lng })) {
      throw new ValidationError("lat/lng out of range");
    }
    if (input.hours < 1 || input.hours > 168) {
      throw new ValidationError("hours must be between 1 and 168");
    }

    const cacheKey = this.cacheKey(input);
    const hit = this.cache.get(cacheKey);
    if (hit) {
      this.logger?.debug("open-meteo cache hit", { cacheKey });
      return hit;
    }

    const url = new URL(`${this.baseUrl}/forecast`);
    url.searchParams.set("latitude", input.lat.toFixed(4));
    url.searchParams.set("longitude", input.lng.toFixed(4));
    url.searchParams.set(
      "hourly",
      "temperature_2m,precipitation,wind_speed_10m,relative_humidity_2m",
    );
    url.searchParams.set("timezone", input.timezone ?? "Asia/Tokyo");
    url.searchParams.set("forecast_hours", String(input.hours));
    url.searchParams.set("wind_speed_unit", "ms");

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: { accept: "application/json" },
      });
    } catch (err) {
      throw new UpstreamError("open-meteo", "network failure", {
        cause: (err as Error).message,
      });
    }
    if (!response.ok) {
      throw new UpstreamError("open-meteo", `unexpected status ${response.status}`);
    }

    let payload: OpenMeteoForecastResponse;
    try {
      payload = (await response.json()) as OpenMeteoForecastResponse;
    } catch {
      throw new UpstreamError("open-meteo", "invalid JSON in upstream response");
    }
    const hourly = payload.hourly;
    if (!hourly) {
      throw new UpstreamError("open-meteo", "missing hourly section in upstream response");
    }

    const forecast: WeatherForecast = {
      source: "open-meteo",
      attribution: ATTRIBUTION,
      location: {
        lat: payload.latitude,
        lng: payload.longitude,
        timezone: payload.timezone,
        ...(typeof payload.elevation === "number" ? { elevationM: payload.elevation } : {}),
      },
      generatedAt: new Date().toISOString(),
      hourly: hourly.time.map((time, i) => ({
        time,
        temperatureC: hourly.temperature_2m[i] ?? Number.NaN,
        precipitationMm: hourly.precipitation[i] ?? 0,
        windSpeedMs: hourly.wind_speed_10m[i] ?? 0,
        relativeHumidity: hourly.relative_humidity_2m[i] ?? 0,
      })),
      alerts: [],
    };

    this.cache.set(cacheKey, forecast);
    return forecast;
  }

  private cacheKey(input: { lat: number; lng: number; hours: number; timezone?: string }): string {
    return [
      input.lat.toFixed(4),
      input.lng.toFixed(4),
      input.hours,
      input.timezone ?? "Asia/Tokyo",
    ].join("|");
  }
}
