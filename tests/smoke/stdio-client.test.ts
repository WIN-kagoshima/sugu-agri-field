import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { OpenMeteoWeatherAdapter } from "../../src/adapters/weather/open-meteo.js";
import { loadConfig } from "../../src/lib/config.js";
import { createLogger } from "../../src/lib/logger.js";
import { createServer } from "../../src/server/create-server.js";

describe("Phase 0 stdio smoke (in-memory transport)", () => {
  it("initializes and lists at least the get_weather_1km tool", async () => {
    const config = loadConfig();
    const logger = createLogger({ level: "warn" });
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            latitude: 31.59,
            longitude: 130.55,
            timezone: "Asia/Tokyo",
            hourly: {
              time: ["2026-05-01T09:00", "2026-05-01T10:00"],
              temperature_2m: [20, 21],
              precipitation: [0, 0],
              wind_speed_10m: [2, 3],
              relative_humidity_2m: [55, 60],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const { server } = createServer({
      config,
      logger,
      version: "0.1.0-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: fakeFetch }),
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("get_weather_1km");

    const result = await client.callTool({
      name: "get_weather_1km",
      arguments: { lat: 31.59, lng: 130.55, hours: 2 },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toMatch(/Forecast for/);
    const sc = result.structuredContent as { attribution?: string; hourly?: unknown[] };
    expect(sc.attribution).toMatch(/Open-Meteo/);
    expect(sc.hourly?.length).toBe(2);

    await client.close();
    await server.close();
  }, 15_000);

  it("returns a safe validation error for out-of-range coordinates", async () => {
    const config = loadConfig();
    const logger = createLogger({ level: "warn" });
    const { server } = createServer({
      config,
      logger,
      version: "0.1.0-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: vi.fn() }),
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({
      name: "get_weather_1km",
      arguments: { lat: 999, lng: 0 },
    });
    expect(result.isError).toBeTruthy();
    const content = result.content as Array<{ type: string; text?: string }>;
    // The SDK validates against the published Zod schema first, so the user
    // sees an "Invalid arguments" message that pinpoints the offending field.
    // Either that or our own "Invalid input" branch is acceptable.
    expect(content[0]?.text).toMatch(/Invalid (input|arguments)/);

    await client.close();
    await server.close();
  }, 15_000);

  it("does not leak server-side stack frames on upstream failure", async () => {
    const config = loadConfig();
    const logger = createLogger({ level: "error" });
    const fakeFetch = vi.fn(async () => {
      throw new Error("ECONNRESET at /home/secret/x.js");
    });
    const { server } = createServer({
      config,
      logger,
      version: "0.1.0-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: fakeFetch }),
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({
      name: "get_weather_1km",
      arguments: { lat: 0, lng: 0 },
    });
    expect(result.isError).toBeTruthy();
    const content = result.content as Array<{ type: string; text?: string }>;
    const text = content.map((c) => c.text ?? "").join(" ");
    expect(text).not.toContain("ECONNRESET");
    expect(text).not.toContain("/home/");

    await client.close();
    await server.close();
  }, 15_000);
});
