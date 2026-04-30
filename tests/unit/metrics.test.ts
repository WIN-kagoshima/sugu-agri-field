import { describe, expect, it } from "vitest";
import { createMetrics } from "../../src/server/metrics.js";

describe("metrics — Prometheus exposition", () => {
  it("includes default labels on every series", () => {
    const m = createMetrics({ defaultLabels: { service: "sugu", version: "0.6.0" } });
    m.inc("mcp_requests_total");
    m.inc("tool_calls_total", { tool: "get_weather_1km", outcome: "ok" });
    const text = m.expose();
    expect(text).toMatch(/mcp_requests_total\{service="sugu",version="0\.6\.0"\} 1/);
    expect(text).toMatch(/tool="get_weather_1km"/);
    expect(text).toMatch(/outcome="ok"/);
  });

  it("emits histogram buckets in increasing order with sum and count", () => {
    const m = createMetrics();
    m.observe("tool_duration_ms", 7);
    m.observe("tool_duration_ms", 30);
    m.observe("tool_duration_ms", 700);
    const text = m.expose();
    expect(text).toMatch(/tool_duration_ms_bucket\{le="5"\} 0/);
    expect(text).toMatch(/tool_duration_ms_bucket\{le="10"\} 1/);
    expect(text).toMatch(/tool_duration_ms_bucket\{le="50"\} 2/);
    expect(text).toMatch(/tool_duration_ms_bucket\{le="\+Inf"\} 3/);
    expect(text).toMatch(/tool_duration_ms_sum.* 737/);
    expect(text).toMatch(/tool_duration_ms_count.* 3/);
  });

  it("escapes embedded quotes in label values", () => {
    const m = createMetrics();
    m.inc("tool_calls_total", { tool: 'evil"inject', outcome: "ok" });
    const text = m.expose();
    expect(text).toMatch(/evil\\"inject/);
  });

  it("middleware gates on the bearer token", async () => {
    const m = createMetrics({ bearerToken: "s3cret" });
    const responses: Array<{ status: number; body: string; type: string }> = [];
    const fakeRes = (status = 200) => {
      const headers = new Map<string, string>();
      const captured = { body: "", status, type: "text/plain" };
      return {
        captured,
        res: {
          status(code: number) {
            captured.status = code;
            return this;
          },
          setHeader(k: string, v: string) {
            headers.set(k.toLowerCase(), v);
            return this;
          },
          type(t: string) {
            captured.type = t;
            return this;
          },
          send(b: string) {
            captured.body = b;
            return this;
          },
        },
      };
    };
    {
      const { res, captured } = fakeRes();
      m.middleware(
        { headers: {} } as unknown as import("express").Request,
        res as unknown as import("express").Response,
      );
      responses.push(captured);
    }
    {
      const { res, captured } = fakeRes();
      m.middleware(
        { headers: { authorization: "Bearer s3cret" } } as unknown as import("express").Request,
        res as unknown as import("express").Response,
      );
      responses.push(captured);
    }
    expect(responses[0]?.status).toBe(401);
    expect(responses[1]?.status).toBe(200);
    expect(responses[1]?.body).toMatch(/^# HELP /m);
  });
});
