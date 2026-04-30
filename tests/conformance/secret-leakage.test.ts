import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { OpenMeteoWeatherAdapter } from "../../src/adapters/weather/open-meteo.js";
import type { Config } from "../../src/lib/config.js";
import { createLogger } from "../../src/lib/logger.js";
import { createServer } from "../../src/server/create-server.js";

/**
 * Defense-in-depth: even if a developer accidentally puts a secret-looking
 * value into config (env var leakage, debug print, etc.), it MUST NOT show
 * up in any of:
 *   - serverInfo / capabilities / instructions
 *   - tools/list, prompts/list, resources/list metadata
 *   - tools/call response content (happy or error paths)
 */

const SECRET_MARKERS = [
  "sk-this-is-a-fake-secret-key-do-not-leak",
  "BEGIN-PRIVATE-KEY",
  "AKIAIOSFODNN7EXAMPLE",
  "AIzaSyDoNotLeakThisGoogleApiKey",
];

function pollutedConfig(): Config {
  return {
    port: 3001,
    logLevel: "warn",
    baseUrl: "http://localhost:3001",
    openMeteoBaseUrl: "https://api.open-meteo.com/v1",
    emaffSnapshotPath: "./snapshots/this-file-does-not-exist.sqlite",
    famicSnapshotPath: "./snapshots/this-file-does-not-exist.sqlite",
    sessionCookieSecret: "BEGIN-PRIVATE-KEY-this-is-fake-but-looks-real",
    demoOAuth: {
      clientId: "client-id-public-ok",
      clientSecret: "sk-this-is-a-fake-secret-key-do-not-leak",
      authorizeUrl: "http://localhost:3001/__mock-oauth/authorize",
      tokenUrl: "http://localhost:3001/__mock-oauth/token",
    },
  };
}

function containsAnySecret(value: unknown): boolean {
  const s = JSON.stringify(value ?? null);
  return SECRET_MARKERS.some((m) => s.includes(m));
}

describe("Secret leakage guardrail", () => {
  it("never exposes secret-looking config in any catalog or call result", async () => {
    const config = pollutedConfig();
    const logger = createLogger({ level: "error" });
    const fakeFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            latitude: 31.59,
            longitude: 130.55,
            timezone: "Asia/Tokyo",
            hourly: {
              time: ["2026-05-01T09:00"],
              temperature_2m: [20],
              precipitation: [0],
              wind_speed_10m: [2],
              relative_humidity_2m: [55],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const { server } = createServer({
      config,
      logger,
      version: "0.5.0-secret-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: fakeFetch }),
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "secret-test", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      expect(containsAnySecret(client.getServerVersion())).toBe(false);
      expect(containsAnySecret(client.getServerCapabilities())).toBe(false);
      expect(containsAnySecret(client.getInstructions())).toBe(false);

      const tools = await client.listTools();
      expect(containsAnySecret(tools)).toBe(false);

      const prompts = await client.listPrompts();
      expect(containsAnySecret(prompts)).toBe(false);

      const resources = await client.listResources();
      expect(containsAnySecret(resources)).toBe(false);

      const ok = await client.callTool({
        name: "get_weather_1km",
        arguments: { lat: 31.59, lng: 130.55, hours: 1 },
      });
      expect(containsAnySecret(ok)).toBe(false);

      const bad = await client.callTool({
        name: "get_weather_1km",
        arguments: { lat: 999, lng: 0 },
      });
      expect(bad.isError).toBe(true);
      expect(containsAnySecret(bad)).toBe(false);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
