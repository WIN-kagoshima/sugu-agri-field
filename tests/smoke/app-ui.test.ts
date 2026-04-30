import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { OpenMeteoWeatherAdapter } from "../../src/adapters/weather/open-meteo.js";
import { loadConfig } from "../../src/lib/config.js";
import { createLogger } from "../../src/lib/logger.js";
import { createServer } from "../../src/server/create-server.js";

describe("Phase 5 MCP Apps UI", () => {
  it("registers ui://sugu-agri/dashboard.html as a resource and returns HTML", async () => {
    const config = loadConfig();
    const logger = createLogger({ level: "warn" });
    const { server } = createServer({
      config,
      logger,
      version: "0.5.0-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: async () => new Response("{}") }),
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const resources = await client.listResources();
    expect(resources.resources.map((r) => r.uri)).toContain("ui://sugu-agri/dashboard.html");

    const read = await client.readResource({ uri: "ui://sugu-agri/dashboard.html" });
    expect(read.contents).toHaveLength(1);
    const c = read.contents[0] as { mimeType?: string; text?: string };
    expect(c.mimeType).toBe("text/html");
    expect(c.text).toMatch(/<!doctype html>/i);

    await client.close();
    await server.close();
  });

  it("open_dashboard returns _meta.openai/outputTemplate for hosts that render apps", async () => {
    const config = loadConfig();
    const logger = createLogger({ level: "warn" });
    const { server } = createServer({
      config,
      logger,
      version: "0.5.0-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: async () => new Response("{}") }),
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({
      name: "open_dashboard",
      arguments: { initialPrefectureCode: "JP-46" },
    });
    expect(result.isError).toBeFalsy();
    const meta = (result as { _meta?: Record<string, unknown> })._meta ?? {};
    expect(meta["openai/outputTemplate"]).toBe("ui://sugu-agri/dashboard.html");

    // Fallback: even on hosts without MCP Apps the LLM gets a useful text summary.
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toMatch(/dashboard/i);

    await client.close();
    await server.close();
  });
});
