import { describe, expect, it } from "vitest";
import { checkToolResultSize, withSizeCap } from "../../src/lib/tool-size.js";

describe("tool-size cap", () => {
  it("accepts small results", () => {
    const result = checkToolResultSize({
      content: [{ type: "text", text: "hello" }],
      structuredContent: { ok: true },
    });
    expect(result.ok).toBe(true);
    expect(result.bytes).toBeGreaterThan(0);
  });

  it("flags oversize structuredContent", () => {
    const big = { rows: new Array(1000).fill({ s: "x".repeat(2000) }) };
    const result = checkToolResultSize({ structuredContent: big }, { maxBytes: 100_000 });
    expect(result.ok).toBe(false);
    expect(result.bytes).toBeGreaterThan(result.maxBytes);
  });

  it("preserves successful inner results when wrapped", async () => {
    const inner = async () => ({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { v: 1 },
      isError: false,
    });
    const wrapped = withSizeCap(inner, { maxBytes: 1000, toolName: "t" });
    const out = (await wrapped({})) as { isError?: boolean; structuredContent?: unknown };
    expect(out.isError).toBeFalsy();
    expect(out.structuredContent).toEqual({ v: 1 });
  });

  it("replaces oversize inner results with a guidance error", async () => {
    const inner = async () => ({
      structuredContent: { rows: new Array(2000).fill({ x: "y".repeat(2000) }) },
      isError: false,
    });
    const wrapped = withSizeCap(inner, { maxBytes: 5000, toolName: "search_farmland" });
    const out = (await wrapped({})) as {
      isError?: boolean;
      content?: Array<{ type: string; text: string }>;
    };
    expect(out.isError).toBe(true);
    const text = out.content?.[0]?.text ?? "";
    expect(text).toMatch(/safety cap/i);
    expect(text).toMatch(/limit|cursor|pagination/);
  });

  it("never alters results that already declared isError", async () => {
    const inner = async () => ({
      isError: true as const,
      content: [{ type: "text" as const, text: "huge but already errored" }],
      structuredContent: { rows: new Array(2000).fill({ x: "y".repeat(2000) }) },
    });
    const wrapped = withSizeCap(inner, { maxBytes: 5000, toolName: "t" });
    const out = (await wrapped({})) as {
      isError?: boolean;
      content?: Array<{ type: string; text: string }>;
    };
    expect(out.isError).toBe(true);
    const text = out.content?.[0]?.text ?? "";
    expect(text).toBe("huge but already errored");
  });
});
