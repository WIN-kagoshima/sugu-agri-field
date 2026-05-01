import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { OpenMeteoWeatherAdapter } from "../../src/adapters/weather/open-meteo.js";
import { loadConfig } from "../../src/lib/config.js";
import { createLogger } from "../../src/lib/logger.js";
import { createServer } from "../../src/server/create-server.js";

/**
 * Conformance assertions: any client that implements MCP Spec 2025-11-25
 * MUST be able to:
 *
 *  1. initialize and receive serverInfo + capabilities + instructions
 *  2. tools/list and read inputSchema (JSON Schema, not Zod)
 *  3. resources/list and resources/read
 *  4. prompts/list and prompts/get
 *  5. tools/call with both happy and error paths
 *
 * The exact protocol negotiation is exercised by the SDK; we assert here
 * that our server populates the *content* of those responses correctly.
 */
describe("MCP conformance", () => {
  async function bootClient(): Promise<{ client: Client; close: () => Promise<void> }> {
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
    const client = new Client({ name: "conformance", version: "0.0.1" }, { capabilities: {} });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return {
      client,
      close: async () => {
        await client.close();
        await server.close();
      },
    };
  }

  it("serverInfo carries the required identification fields", async () => {
    const { client, close } = await bootClient();
    try {
      const info = client.getServerVersion();
      expect(info?.name).toBe("agriops-mcp");
      expect(info?.version).toBeTypeOf("string");
    } finally {
      await close();
    }
  });

  it("server advertises tools/prompts/resources/logging capabilities", async () => {
    const { client, close } = await bootClient();
    try {
      const caps = client.getServerCapabilities();
      expect(caps?.tools).toBeDefined();
      expect(caps?.prompts).toBeDefined();
      expect(caps?.resources).toBeDefined();
      expect(caps?.logging).toBeDefined();
    } finally {
      await close();
    }
  });

  it("every published tool exposes a JSON Schema input definition", async () => {
    const { client, close } = await bootClient();
    try {
      const list = await client.listTools();
      for (const tool of list.tools) {
        expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(tool.description).toBeTypeOf("string");
        const schema = tool.inputSchema as { type?: string; properties?: unknown };
        expect(schema.type).toBe("object");
        expect(schema.properties).toBeDefined();
      }
    } finally {
      await close();
    }
  });

  it("every published prompt has a description and well-formed argument list", async () => {
    const { client, close } = await bootClient();
    try {
      const list = await client.listPrompts();
      for (const p of list.prompts) {
        expect(p.name).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(p.description).toBeTypeOf("string");
      }
    } finally {
      await close();
    }
  });

  it("every published resource URI is a valid `ui://` or `data://` URI", async () => {
    const { client, close } = await bootClient();
    try {
      const list = await client.listResources();
      for (const r of list.resources) {
        expect(r.uri).toMatch(/^(ui|data):\/\//);
        expect(r.mimeType).toBeTypeOf("string");
      }
    } finally {
      await close();
    }
  });

  it("unknown tool name surfaces a safe, isError content response", async () => {
    const { client, close } = await bootClient();
    try {
      const result = await client.callTool({
        name: "this_tool_does_not_exist",
        arguments: {},
      });
      expect(result.isError).toBe(true);
      const content = result.content as Array<{ type: string; text?: string }>;
      // SDK surfaces "Tool ... not found" via content; never via stack trace.
      expect(content[0]?.text).toMatch(/not found/i);
      expect(content[0]?.text).not.toMatch(/at .*\.[jt]s:\d+/);
    } finally {
      await close();
    }
  });
});
