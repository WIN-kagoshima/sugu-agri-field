import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

interface RawHttpResponse {
  status: number;
  body: string;
}

/**
 * Native `fetch` silently overrides the Host header to match the URL,
 * which makes it impossible to simulate a DNS-rebinding payload.
 * `http.request` honours the explicit Host header we pass in, so we
 * use it for the negative-path assertions.
 */
function rawPost(
  url: URL,
  body: string,
  headers: Record<string, string>,
): Promise<RawHttpResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "content-length": String(Buffer.byteLength(body)),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") }),
        );
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

/**
 * Phase 1 HTTP transport security: DNS rebinding / Host header allowlist.
 *
 * The MCP spec REQUIRES Streamable HTTP servers to validate the Host
 * header against an allowlist to defeat DNS rebinding attacks. This
 * suite spawns the actual built server and confirms that:
 *
 *   - A request with `Host: evil.example.com` is rejected with 421
 *     (Misdirected Request) — *not* served and *not* logged as a
 *     successful MCP request.
 *   - The well-known endpoint, which is purely public metadata, still
 *     answers regardless of Host header (it's the same file an
 *     attacker could fetch via the public URL anyway).
 *   - A loopback request with the configured port works.
 */
const distServer = resolve(process.cwd(), "dist", "server.js");

describe.skipIf(!existsSync(distServer))("HTTP transport host-header allowlist", () => {
  let child: ChildProcess | undefined;
  const port = 39102;
  const baseUrl = `http://localhost:${port}`;

  afterAll(() => {
    if (child) {
      child.kill();
    }
  });

  it("rejects /mcp requests with an unallowed Host header", async () => {
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

    const evilRes = await rawPost(
      new URL(`${baseUrl}/mcp`),
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        host: "evil.example.com",
      },
    );

    expect(evilRes.status).toBe(421);
    const body = JSON.parse(evilRes.body) as {
      error?: { code: number; message: string; data?: { requestId?: string } };
    };
    expect(body.error?.code).toBe(-32600);
    expect(body.error?.message).toMatch(/host/i);
    expect(body.error?.data?.requestId).toBeTruthy();

    // Allowlist still answers loopback, and echoes back the X-Request-Id
    // we provide.
    const correlationId = "corr-id-12345-allowlist";
    const okRes = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "x-request-id": correlationId,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "host-header-test", version: "0.0.1" },
        },
      }),
    });
    expect(okRes.status).toBe(200);
    expect(okRes.headers.get("x-request-id")).toBe(correlationId);

    // Public Server Card answers regardless of Host (it's static metadata).
    const cardRes = await fetch(`${baseUrl}/.well-known/mcp-server.json`);
    expect(cardRes.status).toBe(200);
    const card = (await cardRes.json()) as { name?: string };
    expect(card.name).toBe("AgriOps MCP");
  }, 30_000);
});

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
