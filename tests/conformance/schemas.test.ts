import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { OpenMeteoWeatherAdapter } from "../../src/adapters/weather/open-meteo.js";
import { loadConfig } from "../../src/lib/config.js";
import { createLogger } from "../../src/lib/logger.js";
import { createServer } from "../../src/server/create-server.js";

/**
 * Schema-level conformance:
 *  - inputSchema is a JSON Schema object (type=object) with properties
 *  - required[] entries actually appear in properties
 *  - properties carry a `type` (so clients can render forms)
 *  - tool/prompt names are snake_case ASCII (Spec §"Identifiers")
 */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

describe("Tool & prompt schema sanity", () => {
  async function bootClient(): Promise<{ client: Client; close: () => Promise<void> }> {
    const config = loadConfig();
    const logger = createLogger({ level: "warn" });
    const { server } = createServer({
      config,
      logger,
      version: "0.5.0-schema-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: vi.fn() }),
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "schema", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return {
      client,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  }

  it("every tool's inputSchema is structurally valid JSON Schema", async () => {
    const { client, close } = await bootClient();
    try {
      const list = await client.listTools();
      expect(list.tools.length).toBeGreaterThan(0);

      for (const t of list.tools) {
        expect(t.name, "snake_case identifier").toMatch(/^[a-z][a-z0-9_]*$/);
        expect(t.description, `${t.name} has description`).toBeTypeOf("string");
        expect((t.description as string).length, `${t.name} description non-empty`).toBeGreaterThan(
          5,
        );

        const schema = t.inputSchema as Record<string, unknown>;
        expect(schema.type, `${t.name} schema.type`).toBe("object");
        expect(isObject(schema.properties), `${t.name} schema.properties`).toBe(true);

        if (Array.isArray(schema.required)) {
          for (const r of schema.required as string[]) {
            expect(
              (schema.properties as Record<string, unknown>)[r],
              `${t.name}: required field ${r} missing from properties`,
            ).toBeDefined();
          }
        }

        for (const [propName, propRaw] of Object.entries(
          schema.properties as Record<string, unknown>,
        )) {
          if (!isObject(propRaw)) continue;
          const prop = propRaw as { type?: unknown; anyOf?: unknown; oneOf?: unknown };
          const hasShape =
            prop.type !== undefined || prop.anyOf !== undefined || prop.oneOf !== undefined;
          expect(hasShape, `${t.name}.${propName} has type/anyOf/oneOf`).toBe(true);
        }
      }
    } finally {
      await close();
    }
  });

  it("every prompt has snake_case name and a non-empty description", async () => {
    const { client, close } = await bootClient();
    try {
      const list = await client.listPrompts();
      expect(list.prompts.length).toBeGreaterThan(0);
      for (const p of list.prompts) {
        expect(p.name).toMatch(/^[a-z][a-z0-9_]*$/);
        expect((p.description as string).length).toBeGreaterThan(5);
        if (p.arguments) {
          for (const arg of p.arguments) {
            expect(arg.name).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/);
            expect(arg.description).toBeTypeOf("string");
          }
        }
      }
    } finally {
      await close();
    }
  });
});
