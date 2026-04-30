import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildEmaffSnapshot } from "../../scripts/build-snapshots/build-emaff.js";
import { EmaffSqliteAdapter } from "../../src/adapters/emaff-fude.js";

describe("EmaffSqliteAdapter", () => {
  const tmpDir = join(tmpdir(), `sugu-agri-field-emaff-${process.pid}`);
  const dbPath = join(tmpDir, "emaff.sqlite");
  let adapter: EmaffSqliteAdapter;

  beforeAll(async () => {
    await mkdir(tmpDir, { recursive: true });
    const r = await buildEmaffSnapshot({
      rawPath: "tests/fixtures/sample-emaff.geojson",
      outPath: dbPath,
    });
    if (r.status !== "ok") throw new Error(r.message);
    adapter = new EmaffSqliteAdapter({ path: dbPath });
  });

  afterAll(async () => {
    adapter.close();
    if (existsSync(tmpDir)) {
      for (let i = 0; i < 5; i++) {
        try {
          await rm(tmpDir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    }
  });

  it("searches by prefecture", async () => {
    const r = await adapter.search({ prefectureCode: "JP-46", limit: 10 });
    expect(r.fields.length).toBe(3);
    for (const f of r.fields) {
      expect(f.prefectureCode).toBe("JP-46");
      expect(f.attribution).toMatch(/eMAFF/);
    }
  });

  it("searches by crop", async () => {
    const r = await adapter.search({ crop: "茶", limit: 10 });
    expect(r.fields).toHaveLength(1);
    expect(r.fields[0]?.fieldId).toBe("K46-0001-0002");
  });

  it("paginates with cursor when limit hit", async () => {
    const page1 = await adapter.search({ prefectureCode: "JP-46", limit: 2 });
    expect(page1.fields).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await adapter.search({
      prefectureCode: "JP-46",
      limit: 2,
      ...(page1.nextCursor ? { cursor: page1.nextCursor } : {}),
    });
    expect(page2.fields).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
  });

  it("nearby returns only fields within the radius", async () => {
    const r = await adapter.nearby({ lat: 31.735, lng: 130.7625 }, 1_000, 10);
    expect(r.fields.length).toBeGreaterThanOrEqual(1);
    expect(r.fields[0]?.fieldId).toBe("K46-0001-0001");
    // 50 km away — Isa city — should not appear in 1 km radius.
    expect(r.fields.find((f) => f.fieldId === "K46-0002-0001")).toBeUndefined();
  });

  it("returns area summary aggregates", async () => {
    const s = await adapter.areaSummary({ prefectureCode: "JP-46" });
    expect(s.totalFields).toBe(3);
    expect(s.totalAreaHa).toBeGreaterThan(4);
    expect(s.topCrops.map((c) => c.crop)).toEqual(
      expect.arrayContaining(["さつまいも", "茶", "米"]),
    );
  });

  it("get returns null for unknown ids", async () => {
    expect(await adapter.get("does-not-exist")).toBeNull();
  });
});
