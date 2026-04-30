import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { OpenMeteoWeatherAdapter } from "../../src/adapters/weather/open-meteo.js";
import { loadConfig } from "../../src/lib/config.js";
import { createLogger } from "../../src/lib/logger.js";
import { createServer } from "../../src/server/create-server.js";

describe("Phase 2 prompts", () => {
  it("exposes all 5 prompts", async () => {
    const config = loadConfig();
    const logger = createLogger({ level: "warn" });
    const { server } = createServer({
      config,
      logger,
      version: "0.2.0-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: async () => new Response("{}") }),
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const list = await client.listPrompts();
    const names = list.prompts.map((p) => p.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "field_summary",
        "pesticide_advice",
        "staff_deploy_plan",
        "area_briefing",
        "weather_risk_alert",
      ]),
    );

    await client.close();
    await server.close();
  });

  it("staff_deploy_plan returns a prompt message even when eMAFF is not configured", async () => {
    const config = loadConfig();
    const logger = createLogger({ level: "warn" });
    const { server } = createServer({
      config,
      logger,
      version: "0.2.0-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: async () => new Response("{}") }),
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const r = await client.getPrompt({
      name: "staff_deploy_plan",
      arguments: {
        farm_ids: "K46-0001-0001,K46-0002-0001",
        period: "2026-06-01 to 2026-06-30",
      },
    });
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0]?.role).toBe("user");
    const content = r.messages[0]?.content as { text?: string };
    expect(content.text).toMatch(/派遣計画/);

    await client.close();
    await server.close();
  });
});
