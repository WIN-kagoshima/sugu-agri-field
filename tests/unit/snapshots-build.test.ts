import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { buildEmaffSnapshot } from "../../scripts/build-snapshots/build-emaff.js";
import { buildFamicSnapshot } from "../../scripts/build-snapshots/build-famic.js";

describe("snapshot builders", () => {
  const tmpDir = join(tmpdir(), `agriops-mcp-test-${process.pid}`);

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
    await mkdir(tmpDir, { recursive: true });

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

  it("builds an eMAFF snapshot from official OD property names", async () => {
    const out = join(tmpDir, "emaff-official.sqlite");
    await mkdir(tmpDir, { recursive: true });

    const result = await buildEmaffSnapshot({
      rawPath: "tests/fixtures/sample-emaff-official-od.geojson",
      outPath: out,
    });
    expect(result.status).toBe("ok");

    const db = new Database(out, { readonly: true });
    try {
      const row = db.prepare("SELECT * FROM field").get() as {
        field_id: string;
        prefecture_code: string;
        city_code: string;
        registered_crop: string;
      };
      expect(row.field_id).toBe("4fac03f2-2f00-4c80-b882-911541a01fb7");
      expect(row.prefecture_code).toBe("46");
      expect(row.city_code).toBe("462012");
      expect(row.registered_crop).toBe("田");
    } finally {
      db.close();
    }
  });

  it("builds a FAMIC snapshot from a CSV fixture", async () => {
    const out = join(tmpDir, "famic.sqlite");
    await mkdir(tmpDir, { recursive: true });

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

  it("normalizes official FAMIC CSV columns", async () => {
    const out = join(tmpDir, "famic-official.sqlite");
    await mkdir(tmpDir, { recursive: true });

    const result = await buildFamicSnapshot({
      rawPath: "tests/fixtures/sample-famic-official.csv",
      outPath: out,
    });
    expect(result.status).toBe("ok");

    const db = new Database(out, { readonly: true });
    try {
      const row = db.prepare("SELECT * FROM pesticide WHERE registration_id = '52'").get() as {
        product_name: string;
        target_crops: string;
        target_pests: string;
        pre_harvest_interval_days: number;
        max_applications_per_season: number;
      };
      expect(row.product_name).toBe("金鳥除虫菊乳剤3");
      expect(row.target_crops).toContain("きゅうり");
      expect(row.target_crops).toContain("なす");
      expect(row.target_pests).toContain("ｱﾌﾞﾗﾑｼ類");
      expect(row.pre_harvest_interval_days).toBe(1);
      expect(row.max_applications_per_season).toBe(5);
    } finally {
      db.close();
    }
  });
});
