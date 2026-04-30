import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenMeteoWeatherAdapter } from "../../src/adapters/weather/open-meteo.js";
import { UpstreamError, ValidationError } from "../../src/lib/errors.js";

describe("OpenMeteoWeatherAdapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("requests forecast and parses CC-BY attribution", async () => {
    const fetchImpl = vi.fn(async () =>
      ok({
        latitude: 31.59,
        longitude: 130.55,
        timezone: "Asia/Tokyo",
        elevation: 6,
        hourly: {
          time: ["2026-05-01T09:00", "2026-05-01T10:00"],
          temperature_2m: [20.5, 21.7],
          precipitation: [0, 0.2],
          wind_speed_10m: [3.1, 4.0],
          relative_humidity_2m: [55, 60],
        },
      }),
    );
    const adapter = new OpenMeteoWeatherAdapter({ fetchImpl });

    const r = await adapter.getForecast({ lat: 31.59, lng: 130.55, hours: 2 });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(r.source).toBe("open-meteo");
    expect(r.attribution).toMatch(/Open-Meteo\.com.*CC-BY 4\.0/);
    expect(r.hourly).toHaveLength(2);
    expect(r.hourly[0]?.temperatureC).toBe(20.5);
    expect(r.location.timezone).toBe("Asia/Tokyo");
  });

  it("caches subsequent identical calls within the TTL", async () => {
    const fetchImpl = vi.fn(async () =>
      ok({
        latitude: 31.59,
        longitude: 130.55,
        timezone: "Asia/Tokyo",
        hourly: {
          time: ["2026-05-01T09:00"],
          temperature_2m: [20],
          precipitation: [0],
          wind_speed_10m: [1],
          relative_humidity_2m: [50],
        },
      }),
    );
    const adapter = new OpenMeteoWeatherAdapter({
      fetchImpl,
      cacheTtlMs: 60_000,
    });

    await adapter.getForecast({ lat: 31.59, lng: 130.55, hours: 1 });
    await adapter.getForecast({ lat: 31.59, lng: 130.55, hours: 1 });

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects out-of-range coordinates with ValidationError", async () => {
    const adapter = new OpenMeteoWeatherAdapter({
      fetchImpl: vi.fn(),
    });
    await expect(adapter.getForecast({ lat: 99, lng: 0, hours: 1 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("rejects hours outside 1..168 with ValidationError", async () => {
    const adapter = new OpenMeteoWeatherAdapter({
      fetchImpl: vi.fn(),
    });
    await expect(adapter.getForecast({ lat: 0, lng: 0, hours: 0 })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(adapter.getForecast({ lat: 0, lng: 0, hours: 200 })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("turns upstream HTTP errors into UpstreamError without leaking URLs", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 }));
    const adapter = new OpenMeteoWeatherAdapter({ fetchImpl });
    await expect(adapter.getForecast({ lat: 0, lng: 0, hours: 1 })).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });

  it("turns network failures into UpstreamError", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const adapter = new OpenMeteoWeatherAdapter({ fetchImpl });
    await expect(adapter.getForecast({ lat: 0, lng: 0, hours: 1 })).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });
});

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
