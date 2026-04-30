import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildEmaffSnapshot } from "../../scripts/build-snapshots/build-emaff.js";
import { EmaffSqliteAdapter } from "../../src/adapters/emaff-fude.js";
import { OpenMeteoWeatherAdapter } from "../../src/adapters/weather/open-meteo.js";
import { FlatFormSchema, elicitForm } from "../../src/elicitation/form.js";
import { loadConfig } from "../../src/lib/config.js";
import { createLogger } from "../../src/lib/logger.js";
import { createServer } from "../../src/server/create-server.js";

describe("Phase 3 Form elicitation", () => {
  const tmp = join(tmpdir(), `sugu-elicit-${process.pid}`);
  const dbPath = join(tmp, "emaff.sqlite");

  beforeAll(async () => {
    await mkdir(tmp, { recursive: true });
    const r = await buildEmaffSnapshot({
      rawPath: "tests/fixtures/sample-emaff.geojson",
      outPath: dbPath,
    });
    if (r.status !== "ok") throw new Error(r.message);
  });

  afterAll(async () => {
    if (existsSync(tmp)) {
      // Windows occasionally keeps a SQLite handle alive briefly after
      // close() returns; retrying makes the cleanup robust without changing
      // the assertions any test cares about.
      for (let i = 0; i < 5; i++) {
        try {
          await rm(tmp, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    }
  });

  it("FlatFormSchema rejects nested objects (official primitive-only constraint)", () => {
    const bad = {
      type: "object",
      properties: {
        nested: { type: "object", title: "no" },
      },
    };
    expect(() => FlatFormSchema.parse(bad)).toThrow();
  });

  it("FlatFormSchema accepts primitives only", () => {
    const ok = FlatFormSchema.parse({
      type: "object",
      properties: {
        farm_region: {
          type: "string",
          title: "Farm region",
          enum: ["a", "b"],
        },
        period_days: { type: "integer", title: "days", minimum: 1 },
        include_weekend: { type: "boolean", title: "weekend" },
      },
      required: ["farm_region"],
    });
    expect(ok.properties.farm_region?.type).toBe("string");
  });

  it("falls back gracefully when client does not support elicitation", async () => {
    const config = loadConfig();
    const logger = createLogger({ level: "warn" });
    const { server } = createServer({
      config,
      logger,
      version: "0.3.0-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: async () => new Response("{}") }),
        emaff: new EmaffSqliteAdapter({ path: dbPath }),
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    // Client advertises NO elicitation capability — server must fall back.
    const client = new Client({ name: "test", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({
      name: "create_staff_deploy_plan",
      arguments: {}, // missing farm_region & periodDays — would normally elicit
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text?: string }>;
    expect(content[0]?.text).toMatch(/declined|does not support|cancelled|all arguments/i);

    await client.close();
    await server.close();
  });

  it("computes a draft plan when full inputs are passed up-front", async () => {
    const config = loadConfig();
    const logger = createLogger({ level: "warn" });
    const { server } = createServer({
      config,
      logger,
      version: "0.3.0-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: async () => new Response("{}") }),
        emaff: new EmaffSqliteAdapter({ path: dbPath }),
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    const result = await client.callTool({
      name: "create_staff_deploy_plan",
      arguments: {
        farmRegion: "kirishima_kokubu",
        periodDays: 14,
        includeWeekend: false,
      },
    });
    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as {
      status?: string;
      farmRegion?: string;
      estimatedStaffDays?: number;
    };
    expect(sc.status).toBe("draft");
    expect(sc.farmRegion).toBe("kirishima_kokubu");
    expect(typeof sc.estimatedStaffDays).toBe("number");

    await client.close();
    await server.close();
  });

  it("elicitForm helper validates flat-only primitive shape locally", async () => {
    // Calling elicitForm with a mock server that has no elicitInput should
    // immediately resolve as { action: "decline" }.
    const fakeServer = { server: undefined } as unknown as Parameters<typeof elicitForm>[0];
    const result = await elicitForm(fakeServer, "test", {
      type: "object",
      properties: {
        x: { type: "string", title: "X" },
      },
    });
    expect(result.action).toBe("decline");
  });
});
