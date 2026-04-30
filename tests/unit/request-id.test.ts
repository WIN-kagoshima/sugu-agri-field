import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRequestId, requestIdMiddleware } from "../../src/server/request-id.js";

describe("requestIdMiddleware", () => {
  let baseUrl: string;
  let server: import("node:http").Server;

  beforeAll(async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.get("/echo", (_req, res) => {
      res.json({ requestId: getRequestId(res) });
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("generates a UUID when X-Request-Id is absent", async () => {
    const res = await fetch(`${baseUrl}/echo`);
    const echoed = res.headers.get("x-request-id");
    const body = (await res.json()) as { requestId: string };
    expect(echoed).toBeTruthy();
    expect(echoed).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(body.requestId).toBe(echoed);
  });

  it("reuses a well-formed caller-supplied X-Request-Id", async () => {
    const provided = "abc12345-corr-id-1234567890";
    const res = await fetch(`${baseUrl}/echo`, {
      headers: { "x-request-id": provided },
    });
    expect(res.headers.get("x-request-id")).toBe(provided);
    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).toBe(provided);
  });

  it("ignores caller-supplied IDs that are too short", async () => {
    const res = await fetch(`${baseUrl}/echo`, {
      headers: { "x-request-id": "short" },
    });
    expect(res.headers.get("x-request-id")).not.toBe("short");
    expect(res.headers.get("x-request-id")?.length).toBeGreaterThanOrEqual(36);
  });

  it("ignores caller-supplied IDs containing non-printable characters", async () => {
    const res = await fetch(`${baseUrl}/echo`, {
      headers: { "x-request-id": "abc12345 with space" },
    });
    expect(res.headers.get("x-request-id")).not.toBe("abc12345 with space");
  });

  it("ignores caller-supplied IDs that are too long", async () => {
    const res = await fetch(`${baseUrl}/echo`, {
      headers: { "x-request-id": "a".repeat(200) },
    });
    expect(res.headers.get("x-request-id")?.length).toBeLessThanOrEqual(40);
  });
});
