import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TtlCache } from "../../src/lib/cache.js";

describe("TtlCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the value before TTL", () => {
    const c = new TtlCache<string, number>(60_000);
    c.set("a", 42);
    vi.advanceTimersByTime(30_000);
    expect(c.get("a")).toBe(42);
  });

  it("expires the value after TTL", () => {
    const c = new TtlCache<string, number>(60_000);
    c.set("a", 42);
    vi.advanceTimersByTime(60_001);
    expect(c.get("a")).toBeUndefined();
  });

  it("getOrSet runs factory exactly once when called twice within TTL", async () => {
    const c = new TtlCache<string, number>(60_000);
    const factory = vi.fn(async () => 7);
    expect(await c.getOrSet("k", factory)).toBe(7);
    expect(await c.getOrSet("k", factory)).toBe(7);
    expect(factory).toHaveBeenCalledOnce();
  });
});
