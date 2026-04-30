import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { JmaWarningAdapter } from "../../src/adapters/weather/jma-warning.js";
import { OpenMeteoWeatherAdapter } from "../../src/adapters/weather/open-meteo.js";
import { loadConfig } from "../../src/lib/config.js";
import { createLogger } from "../../src/lib/logger.js";
import { createServer } from "../../src/server/create-server.js";

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>大雨警報（土砂災害）</title>
    <updated>2026-04-30T10:00:00+09:00</updated>
    <author><name>鹿児島地方気象台</name></author>
    <link href="https://www.data.jma.go.jp/developer/xml/data/abc.xml"/>
    <content type="text">【鹿児島県本土】土砂災害の危険度が高まっています。</content>
  </entry>
</feed>`;

describe("Phase 1+ get_weather_warning tool (JMA)", () => {
  it("returns the active warning for the requested prefecture with attribution", async () => {
    const config = loadConfig();
    const logger = createLogger({ level: "warn" });
    const fakeFetch = vi.fn(async () => new Response(FEED, { status: 200 }));
    const { server } = createServer({
      config,
      logger,
      version: "0.6.0-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: vi.fn() }),
        jma: new JmaWarningAdapter({ fetchImpl: fakeFetch }),
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "jma-smoke", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({
      name: "get_weather_warning",
      arguments: { prefectureCode: "JP-46", severityAtLeast: "advisory" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      warnings: Array<{ prefectureCode: string; kind: string }>;
      attribution: string;
      count: number;
    };
    expect(sc.count).toBe(1);
    expect(sc.warnings[0]?.prefectureCode).toBe("JP-46");
    expect(sc.attribution).toMatch(/気象庁/);

    await client.close();
    await server.close();
  });

  it("returns an empty result without erroring when nothing matches the severity floor", async () => {
    const config = loadConfig();
    const logger = createLogger({ level: "warn" });
    const fakeFetch = vi.fn(async () => new Response(FEED, { status: 200 }));
    const { server } = createServer({
      config,
      logger,
      version: "0.6.0-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: vi.fn() }),
        jma: new JmaWarningAdapter({ fetchImpl: fakeFetch }),
      },
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "jma-smoke", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({
      name: "get_weather_warning",
      arguments: { prefectureCode: "JP-46", severityAtLeast: "tokubetsu" },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as { count: number };
    expect(sc.count).toBe(0);

    await client.close();
    await server.close();
  });

  it("is hidden from the tools list when JMA adapter is disabled", async () => {
    const config = loadConfig();
    const logger = createLogger({ level: "warn" });
    const { server } = createServer({
      config,
      logger,
      version: "0.6.0-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: vi.fn() }),
        jma: null,
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "jma-smoke", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).not.toContain("get_weather_warning");

    await client.close();
    await server.close();
  });
});
