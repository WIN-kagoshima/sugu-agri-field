import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { OpenMeteoWeatherAdapter } from "../../src/adapters/weather/open-meteo.js";
import { loadConfig } from "../../src/lib/config.js";
import { createLogger } from "../../src/lib/logger.js";
import { createServer } from "../../src/server/create-server.js";
import { TOOL_METADATA } from "../../src/server/surface-catalog.js";

interface AnnotationsView {
  readOnlyHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  destructiveHint?: boolean;
  title?: string;
}

function annotationsOf(t: { annotations?: unknown }): AnnotationsView | undefined {
  return t.annotations as AnnotationsView | undefined;
}

/**
 * Conformance: every registered tool surfaces a spec-compliant
 * `ToolAnnotations` block on `tools/list` (MCP Spec 2025-11-25 §6.10) and
 * those hints agree with our internal `sideEffect` classification so a
 * regression on either side blocks CI.
 */
describe("Tool annotations conformance", () => {
  async function bootClient() {
    const config = loadConfig();
    const logger = createLogger({ level: "warn" });
    const { server } = createServer({
      config,
      logger,
      version: "0.5.0-annotations-test",
      overrides: {
        weather: new OpenMeteoWeatherAdapter({ fetchImpl: vi.fn() }),
      },
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "annot", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return {
      client,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  }

  it("every registered tool exposes annotations on tools/list", async () => {
    const { client, close } = await bootClient();
    try {
      const live = await client.listTools();
      for (const t of live.tools) {
        const a = annotationsOf(t);
        expect(a, `${t.name} is missing the spec ToolAnnotations block`).toBeDefined();
        if (!a) continue;
        expect(typeof a.readOnlyHint, `${t.name}.readOnlyHint must be boolean`).toBe("boolean");
        expect(typeof a.idempotentHint, `${t.name}.idempotentHint must be boolean`).toBe("boolean");
        expect(typeof a.openWorldHint, `${t.name}.openWorldHint must be boolean`).toBe("boolean");
        expect(typeof a.destructiveHint, `${t.name}.destructiveHint must be boolean`).toBe(
          "boolean",
        );
      }
    } finally {
      await close();
    }
  });

  it("annotations agree with the internal sideEffect classification", async () => {
    const { client, close } = await bootClient();
    try {
      const live = await client.listTools();
      for (const t of live.tools) {
        const meta = TOOL_METADATA[t.name];
        expect(meta, `tool ${t.name} missing from TOOL_METADATA`).toBeDefined();
        const a = annotationsOf(t);
        if (!meta || !a) continue;

        if (meta.sideEffect === "destructive") {
          expect(a.destructiveHint, `${t.name} marked destructive must hint so`).toBe(true);
          expect(a.readOnlyHint, `${t.name} destructive cannot be read-only`).toBe(false);
        }

        if (meta.sideEffect === "read-only") {
          expect(a.destructiveHint, `${t.name} read-only cannot be destructive`).toBe(false);
        }

        if (meta.sideEffect === "mutating") {
          expect(a.readOnlyHint, `${t.name} mutating cannot be read-only`).toBe(false);
        }
      }
    } finally {
      await close();
    }
  });

  it("openWorldHint is true exactly for tools that touch the network", async () => {
    const { client, close } = await bootClient();
    try {
      const live = await client.listTools();
      const expectedRemote = new Set([
        "get_weather_1km",
        "get_weather_warning",
        "fetch_weather_layer",
      ]);
      for (const t of live.tools) {
        const a = annotationsOf(t);
        if (!a) continue;
        const want = expectedRemote.has(t.name);
        expect(
          a.openWorldHint,
          `${t.name}: openWorldHint=${a.openWorldHint}, expected ${want}`,
        ).toBe(want);
      }
    } finally {
      await close();
    }
  });
});
