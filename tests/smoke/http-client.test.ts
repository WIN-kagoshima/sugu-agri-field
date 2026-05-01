import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, describe, expect, it } from "vitest";

/**
 * Spawns the built `dist/server.js --http`, waits for it to listen, and
 * connects an SDK client over Streamable HTTP. Mirrors the production
 * Cloud Run path as closely as possible without docker.
 *
 * Skipped automatically if `dist/server.js` does not exist (run `npm run
 * build` before invoking this suite).
 */
const distServer = resolve(process.cwd(), "dist", "server.js");

describe.skipIf(!hasDistServer())("Phase 1 Streamable HTTP smoke", () => {
  let child: ChildProcess | undefined;
  const port = 39101;
  const baseUrl = `http://localhost:${port}`;

  afterAll(() => {
    if (child) {
      child.kill();
    }
  });

  it("server card and tools/list both work", async () => {
    child = spawn(process.execPath, [distServer, "--http"], {
      env: {
        ...process.env,
        PORT: String(port),
        MCP_BASE_URL: baseUrl,
        LOG_LEVEL: "warn",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await waitForHealthz(baseUrl, 15_000);

    // Server Card
    const cardRes = await fetch(`${baseUrl}/.well-known/mcp-server.json`);
    expect(cardRes.status).toBe(200);
    const card = (await cardRes.json()) as { name: string; tools: Array<{ name: string }> };
    expect(card.name).toBe("AgriOps MCP");
    expect(card.tools.map((t) => t.name)).toContain("get_weather_1km");

    // MCP tools/list
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));
    const client = new Client({ name: "http-smoke", version: "0.0.1" }, { capabilities: {} });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("get_weather_1km");
    await client.close();
  }, 30_000);
});

function hasDistServer(): boolean {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    return fs.existsSync(distServer);
  } catch {
    return false;
  }
}

async function waitForHealthz(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${baseUrl}/healthz`);
      if (r.ok) return;
    } catch {
      // not yet listening
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not become ready in ${timeoutMs}ms`);
}
