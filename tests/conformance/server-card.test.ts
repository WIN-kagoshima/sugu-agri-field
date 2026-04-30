import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { OpenMeteoWeatherAdapter } from "../../src/adapters/weather/open-meteo.js";
import { loadConfig } from "../../src/lib/config.js";
import { createLogger } from "../../src/lib/logger.js";
import { createServer } from "../../src/server/create-server.js";
import type { RegisteredSurface } from "../../src/server/surface-catalog.js";
import { buildServerCard } from "../../src/server/well-known.js";

/**
 * Server-Card / actually-registered-surface integrity test.
 *
 * The `.well-known/mcp-server.json` document is the public contract for
 * registries and crawlers. If it disagrees with what `tools/list`,
 * `prompts/list`, or `resources/list` returns, that's a release bug we
 * want to catch at CI time, not at registry-listing time.
 *
 * We compare the *names* declared in the Server Card against the names
 * returned by a live in-memory client. New tools must be added to BOTH
 * the registry and the well-known builder before they ship.
 */
describe("Server Card conformance", () => {
  async function bootClient(): Promise<{
    client: Client;
    surface: RegisteredSurface;
    close: () => Promise<void>;
  }> {
    const config = loadConfig();
    const logger = createLogger({ level: "warn" });
    const { server, surface } = createServer({
      config,
      logger,
      version: "0.5.0-card-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: vi.fn() }),
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "card", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return {
      client,
      surface,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  }

  it("Server Card tools[] exactly matches the live tools/list", async () => {
    const { client, surface, close } = await bootClient();
    try {
      const card = buildServerCard({
        baseUrl: "https://example.test",
        version: "0.5.0",
        surface,
      });
      const cardTools = (card.tools as Array<{ name: string }>).map((t) => t.name).sort();
      const live = await client.listTools();
      const liveTools = live.tools.map((t) => t.name).sort();

      expect(cardTools).toEqual(liveTools);
    } finally {
      await close();
    }
  });

  it("Server Card prompts[] exactly matches the live prompts/list", async () => {
    const { client, surface, close } = await bootClient();
    try {
      const card = buildServerCard({
        baseUrl: "https://example.test",
        version: "0.5.0",
        surface,
      });
      const cardPrompts = (card.prompts as Array<{ name: string }>).map((p) => p.name).sort();
      const live = await client.listPrompts();
      const livePrompts = live.prompts.map((p) => p.name).sort();

      expect(cardPrompts).toEqual(livePrompts);
    } finally {
      await close();
    }
  });

  it("Server Card apps[] points at registered ui:// resources", async () => {
    const { client, surface, close } = await bootClient();
    try {
      const card = buildServerCard({
        baseUrl: "https://example.test",
        version: "0.5.0",
        surface,
      });
      const cardUris = (card.apps as Array<{ uri: string }>).map((a) => a.uri);
      const live = await client.listResources();
      const liveUris = live.resources.map((r) => r.uri);

      for (const uri of cardUris) {
        expect(liveUris, `Server Card advertises ${uri} but no resource is registered`).toContain(
          uri,
        );
      }
    } finally {
      await close();
    }
  });

  it("declared capabilities match the live serverInfo", async () => {
    const { client, surface, close } = await bootClient();
    try {
      const card = buildServerCard({
        baseUrl: "https://example.test",
        version: "0.5.0",
        surface,
      });
      const cardCaps = card.capabilities as Record<string, unknown>;
      const liveCaps = client.getServerCapabilities() as Record<string, unknown>;

      for (const key of Object.keys(cardCaps)) {
        expect(liveCaps[key], `capability ${key} declared in card but missing live`).toBeDefined();
      }
    } finally {
      await close();
    }
  });

  it("every model-visible tool has a substantive description", async () => {
    const { client, close } = await bootClient();
    try {
      const live = await client.listTools();
      for (const t of live.tools) {
        const text = (t.description ?? "") as string;
        expect(text.length, `${t.name} has empty description`).toBeGreaterThan(20);
      }
    } finally {
      await close();
    }
  });

  it("Phase 0 mode (no eMAFF/FAMIC) advertises only weather tools in the card", async () => {
    const config = loadConfig();
    const logger = createLogger({ level: "warn" });
    const { server, surface } = createServer({
      config,
      logger,
      version: "0.5.0-phase0-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: vi.fn() }),
        emaff: null,
        famic: null,
      },
    });
    try {
      const card = buildServerCard({
        baseUrl: "https://example.test",
        version: "0.5.0",
        surface,
      });
      const cardTools = (card.tools as Array<{ name: string }>).map((t) => t.name);
      expect(cardTools).toContain("get_weather_1km");
      expect(cardTools).not.toContain("search_farmland");
      expect(cardTools).not.toContain("get_pesticide_rules");
      expect(cardTools).not.toContain("create_staff_deploy_plan");
    } finally {
      await server.close();
    }
  });
});
