import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildEmaffSnapshot } from "../../scripts/build-snapshots/build-emaff.js";
import { buildFamicSnapshot } from "../../scripts/build-snapshots/build-famic.js";

describe("snapshot builders", () => {
  const tmpDir = join(tmpdir(), `sugu-agri-field-test-${process.pid}`);

  afterEach(async () => {
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

  it("builds an eMAFF snapshot with R*Tree from a GeoJSON fixture", async () => {
    const out = join(tmpDir, "emaff.sqlite");
    await import("node:fs/promises").then((m) => m.mkdir(tmpDir, { recursive: true }));

    const result = await buildEmaffSnapshot({
      rawPath: "tests/fixtures/sample-emaff.geojson",
      outPath: out,
    });
    expect(result.status).toBe("ok");

    const db = new Database(out, { readonly: true });
    try {
      const count = (db.prepare("SELECT COUNT(*) AS n FROM field").get() as { n: number }).n;
      expect(count).toBe(3);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE name = 'field_rtree'")
        .all() as Array<{ name: string }>;
      expect(tables.length).toBe(1);

      // R*Tree index works.
      const inBox = db
        .prepare(
          `SELECT f.field_id FROM field f
           JOIN field_rtree r ON r.id = f.rowid
           WHERE r.minLat <= 31.75 AND r.maxLat >= 31.73
             AND r.minLng <= 130.78 AND r.maxLng >= 130.76`,
        )
        .all() as Array<{ field_id: string }>;
      expect(inBox.map((r) => r.field_id)).toContain("K46-0001-0001");
    } finally {
      db.close();
    }
  });

  it("skips with an instructive message when the raw GeoJSON is missing", async () => {
    const out = join(tmpDir, "missing.sqlite");
    const result = await buildEmaffSnapshot({
      rawPath: "tests/fixtures/does-not-exist.geojson",
      outPath: out,
    });
    expect(result.status).toBe("skipped");
    expect(result.message).toMatch(/open\.fude\.maff\.go\.jp/);
  });

  it("builds a FAMIC snapshot from a CSV fixture", async () => {
    const out = join(tmpDir, "famic.sqlite");
    await import("node:fs/promises").then((m) => m.mkdir(tmpDir, { recursive: true }));

    const result = await buildFamicSnapshot({
      rawPath: "tests/fixtures/sample-famic.csv",
      outPath: out,
    });
    expect(result.status).toBe("ok");

    const db = new Database(out, { readonly: true });
    try {
      const rows = db
        .prepare("SELECT registration_id, product_name FROM pesticide")
        .all() as Array<{
        registration_id: string;
        product_name: string;
      }>;
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => r.registration_id)).toContain("R-2026-001");
    } finally {
      db.close();
    }
  });
});
