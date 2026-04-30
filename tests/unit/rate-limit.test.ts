import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createRateLimiter } from "../../src/server/rate-limit.js";

interface CapturedReq {
  status: number;
  body: unknown;
  headers: Headers;
}

async function callMany(baseUrl: string, n: number, ip = "10.0.0.1"): Promise<CapturedReq[]> {
  const out: CapturedReq[] = [];
  for (let i = 0; i < n; i++) {
    const r = await fetch(`${baseUrl}/probe`, {
      method: "POST",
      headers: { "x-forwarded-for": ip, "content-type": "application/json" },
      body: "{}",
    });
    let body: unknown = null;
    try {
      body = await r.json();
    } catch {
      // ignore
    }
    out.push({ status: r.status, body, headers: r.headers });
  }
  return out;
}

describe("rate-limit middleware", () => {
  let server: import("node:http").Server | undefined;

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server?.close(() => resolve()));
      server = undefined;
    }
  });

  async function bootApp(opts: Parameters<typeof createRateLimiter>[0] = {}): Promise<{
    baseUrl: string;
  }> {
    const limiter = createRateLimiter(opts);
    const app = express();
    app.set("trust proxy", 1);
    app.use(express.json());
    app.post("/probe", limiter.middleware, (_req, res) => {
      res.json({ ok: true });
    });
    server = await new Promise<import("node:http").Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const addr = server.address() as AddressInfo;
    return { baseUrl: `http://127.0.0.1:${addr.port}` };
  }

  it("permits a burst up to capacity then 429s", async () => {
    const { baseUrl } = await bootApp({ burst: 4, refillPerSec: 0.001 });
    const responses = await callMany(baseUrl, 8);
    const ok = responses.filter((r) => r.status === 200);
    const limited = responses.filter((r) => r.status === 429);
    expect(ok.length).toBe(4);
    expect(limited.length).toBe(4);
    const r = limited[0];
    expect(r).toBeDefined();
    if (!r) throw new Error("no limited response");
    expect(r.headers.get("retry-after")).toBeTruthy();
    const body = r.body as { error: { code: number; data?: { retryAfterSec: number } } };
    expect(body.error.code).toBe(-32429);
    expect(body.error.data?.retryAfterSec).toBeGreaterThan(0);
  });

  it("isolates buckets per X-Forwarded-For client", async () => {
    const { baseUrl } = await bootApp({ burst: 2, refillPerSec: 0.001 });
    const a = await callMany(baseUrl, 2, "1.1.1.1");
    const b = await callMany(baseUrl, 2, "2.2.2.2");
    expect(a.every((r) => r.status === 200)).toBe(true);
    expect(b.every((r) => r.status === 200)).toBe(true);
  });

  it("refills the bucket over time", async () => {
    const { baseUrl } = await bootApp({ burst: 1, refillPerSec: 50 });
    const first = await callMany(baseUrl, 1, "9.9.9.9");
    expect(first[0]?.status).toBe(200);
    // 30 ms = 1.5 tokens at 50 rps; one should be enough.
    await new Promise((r) => setTimeout(r, 50));
    const second = await callMany(baseUrl, 1, "9.9.9.9");
    expect(second[0]?.status).toBe(200);
  });

  it("exposes X-RateLimit-Limit and Remaining headers", async () => {
    const { baseUrl } = await bootApp({ burst: 5, refillPerSec: 0.001 });
    const r = await callMany(baseUrl, 1, "5.5.5.5");
    const first = r[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("no response");
    expect(first.headers.get("x-ratelimit-limit")).toBe("5");
    expect(Number(first.headers.get("x-ratelimit-remaining"))).toBeGreaterThanOrEqual(0);
  });
});
