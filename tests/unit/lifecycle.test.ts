import type { AddressInfo } from "node:net";
import express, { type Request, type Response } from "express";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/lib/logger.js";
import { Lifecycle } from "../../src/server/lifecycle.js";

describe("Lifecycle", () => {
  it("starts in 'running' and reports healthy", () => {
    const lc = new Lifecycle({ logger: createLogger({ level: "warn" }) });
    expect(lc.getState()).toBe("running");
    expect(lc.isHealthy()).toBe(true);
  });

  it("drain() resolves immediately when there are no inflight requests", async () => {
    const lc = new Lifecycle({ logger: createLogger({ level: "warn" }) });
    const result = await lc.drain();
    expect(result.timedOut).toBe(false);
    expect(result.remaining).toBe(0);
    expect(lc.getState()).toBe("stopped");
  });

  it("middleware rejects with 503 once draining", async () => {
    const lc = new Lifecycle({ logger: createLogger({ level: "warn" }) });
    const app = express();
    app.use(lc.middleware);
    app.get("/", (_req: Request, res: Response) => res.json({ ok: true }));
    const server = await new Promise<import("node:http").Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const { port } = server.address() as AddressInfo;
    try {
      const r1 = await fetch(`http://127.0.0.1:${port}/`);
      expect(r1.status).toBe(200);

      await lc.drain();

      const r2 = await fetch(`http://127.0.0.1:${port}/`);
      expect(r2.status).toBe(503);
      expect(r2.headers.get("retry-after")).toBe("5");
      const body = (await r2.json()) as { error: { code: number; message: string } };
      expect(body.error.code).toBe(-32000);
      expect(body.error.message).toMatch(/draining/i);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("times out and reports remaining when shutdown budget elapses", async () => {
    const lc = new Lifecycle({
      logger: createLogger({ level: "warn" }),
      shutdownTimeoutMs: 50,
    });
    // Simulate an inflight request by directly invoking middleware.
    const req = { headers: {} } as unknown as Request;
    let onClose: (() => void) | undefined;
    const res = {
      on(event: string, cb: () => void) {
        if (event === "close") onClose = cb;
        return this;
      },
      setHeader: () => res,
      status: () => res,
      json: () => res,
    } as unknown as Response;
    lc.middleware(req, res, () => {
      // simulate handler running
    });
    const result = await lc.drain();
    expect(result.timedOut).toBe(true);
    expect(result.remaining).toBe(1);
    // Now finish the inflight request — make sure no leftover waiters
    // hold the process alive.
    onClose?.();
  });
});
