import { existsSync } from "node:fs";
import Database, { type Database as Db } from "better-sqlite3";
import { NotFoundError, UpstreamError } from "../lib/errors.js";
import { type LatLng, bboxFromRadius, haversineMeters } from "../lib/geo.js";
import type { Logger } from "../lib/logger.js";
import type { AreaSummary, Farmland, FarmlandSearchResult } from "../types/farmland.js";
import type { EmaffAdapter } from "./_interface.js";

const ATTRIBUTION = "Source: 農林水産省 eMAFF 筆ポリゴン (open data)";
const DEFAULT_LIMIT = 20;
const HARD_LIMIT = 100;

export interface EmaffSqliteOptions {
  path: string;
  logger?: Logger;
  attribution?: string;
}

interface FieldRow {
  field_id: string;
  polygon_id: string;
  prefecture_code: string;
  city_code: string;
  address: string | null;
  centroid_lat: number;
  centroid_lng: number;
  area_m2: number;
  registered_crop: string | null;
}

/**
 * Read-only SQLite adapter over a snapshot of eMAFF Fude polygons.
 *
 * The snapshot is built locally by `scripts/build-snapshots/build-emaff.ts`.
 * This adapter never writes to the file. Both the regular `field` table
 * and the R*Tree spatial index `field_rtree` are required.
 */
export class EmaffSqliteAdapter implements EmaffAdapter {
  private readonly db: Db;
  private readonly logger: Logger | undefined;
  private readonly attribution: string;

  constructor(options: EmaffSqliteOptions) {
    if (!existsSync(options.path)) {
      throw new UpstreamError("emaff-sqlite", `snapshot not found at ${options.path}`);
    }
    this.db = new Database(options.path, { readonly: true, fileMustExist: true });
    this.db.pragma("query_only = ON");
    this.logger = options.logger;
    this.attribution = options.attribution ?? ATTRIBUTION;
  }

  close(): void {
    this.db.close();
  }

  async search(input: {
    query?: string;
    prefectureCode?: string;
    cityCode?: string;
    crop?: string;
    limit: number;
    cursor?: string;
  }): Promise<FarmlandSearchResult> {
    const limit = clampLimit(input.limit);
    const offset = decodeCursor(input.cursor);
    const filters: string[] = [];
    const params: Record<string, string | number> = { limit, offset };

    if (input.prefectureCode) {
      filters.push("prefecture_code = @prefectureCode");
      params.prefectureCode = input.prefectureCode;
    }
    if (input.cityCode) {
      filters.push("city_code = @cityCode");
      params.cityCode = input.cityCode;
    }
    if (input.crop) {
      filters.push("registered_crop = @crop");
      params.crop = input.crop;
    }
    if (input.query) {
      filters.push("(address LIKE @q OR field_id LIKE @q OR polygon_id LIKE @q)");
      params.q = `%${input.query}%`;
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const sql = `
      SELECT field_id, polygon_id, prefecture_code, city_code, address,
             centroid_lat, centroid_lng, area_m2, registered_crop
      FROM field
      ${where}
      ORDER BY field_id
      LIMIT @limit OFFSET @offset
    `;

    const rows = this.db.prepare<unknown[], FieldRow>(sql).all(params) as FieldRow[];
    const fields = rows.map((r) => this.mapRow(r));
    const nextCursor = fields.length === limit ? encodeCursor(offset + limit) : null;
    return {
      fields,
      nextCursor,
      attribution: this.attribution,
    };
  }

  async get(fieldId: string): Promise<Farmland | null> {
    const row = this.db
      .prepare<unknown[], FieldRow>(
        `SELECT field_id, polygon_id, prefecture_code, city_code, address,
                centroid_lat, centroid_lng, area_m2, registered_crop
         FROM field WHERE field_id = ?`,
      )
      .get(fieldId) as FieldRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  async nearby(center: LatLng, radiusMeters: number, limit: number): Promise<FarmlandSearchResult> {
    const lim = clampLimit(limit);
    const bbox = bboxFromRadius(center, radiusMeters);
    let rows: FieldRow[];
    try {
      rows = this.db
        .prepare<unknown[], FieldRow>(
          `SELECT f.field_id, f.polygon_id, f.prefecture_code, f.city_code, f.address,
                  f.centroid_lat, f.centroid_lng, f.area_m2, f.registered_crop
           FROM field f
           JOIN field_rtree r ON r.id = f.rowid
           WHERE r.minLat <= @maxLat AND r.maxLat >= @minLat
             AND r.minLng <= @maxLng AND r.maxLng >= @minLng
           LIMIT @candidates`,
        )
        .all({
          minLat: bbox.minLat,
          maxLat: bbox.maxLat,
          minLng: bbox.minLng,
          maxLng: bbox.maxLng,
          candidates: lim * 4,
        }) as FieldRow[];
    } catch (err) {
      this.logger?.warn("R*Tree query failed, falling back to linear scan", {
        error: (err as Error).message,
      });
      rows = this.db
        .prepare<unknown[], FieldRow>(
          `SELECT field_id, polygon_id, prefecture_code, city_code, address,
                  centroid_lat, centroid_lng, area_m2, registered_crop
           FROM field
           WHERE centroid_lat BETWEEN @minLat AND @maxLat
             AND centroid_lng BETWEEN @minLng AND @maxLng
           LIMIT @candidates`,
        )
        .all({
          minLat: bbox.minLat,
          maxLat: bbox.maxLat,
          minLng: bbox.minLng,
          maxLng: bbox.maxLng,
          candidates: lim * 4,
        }) as FieldRow[];
    }

    const filtered = rows
      .map((r) => this.mapRow(r))
      .filter(
        (f) =>
          haversineMeters(center, { lat: f.centroid.lat, lng: f.centroid.lng }) <= radiusMeters,
      )
      .slice(0, lim);
    return {
      fields: filtered,
      nextCursor: null,
      attribution: this.attribution,
    };
  }

  async areaSummary(input: { prefectureCode?: string; cityCode?: string }): Promise<AreaSummary> {
    if (!input.prefectureCode && !input.cityCode) {
      throw new NotFoundError("area", "no filter provided");
    }
    const filters: string[] = [];
    const params: Record<string, string | number> = {};
    if (input.prefectureCode) {
      filters.push("prefecture_code = @prefectureCode");
      params.prefectureCode = input.prefectureCode;
    }
    if (input.cityCode) {
      filters.push("city_code = @cityCode");
      params.cityCode = input.cityCode;
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

    const totals = this.db
      .prepare<unknown[], { total_fields: number; total_area_m2: number | null }>(
        `SELECT COUNT(*) AS total_fields, SUM(area_m2) AS total_area_m2 FROM field ${where}`,
      )
      .get(params) as { total_fields: number; total_area_m2: number | null };

    const cropRows = this.db
      .prepare<unknown[], { crop: string; cnt: number }>(
        `SELECT registered_crop AS crop, COUNT(*) AS cnt
         FROM field ${where} ${where ? "AND" : "WHERE"} registered_crop IS NOT NULL
         GROUP BY registered_crop ORDER BY cnt DESC LIMIT 20`,
      )
      .all(params) as Array<{ crop: string; cnt: number }>;

    return {
      prefectureCode: input.prefectureCode ?? null,
      cityCode: input.cityCode ?? null,
      totalFields: totals.total_fields,
      totalAreaHa: (totals.total_area_m2 ?? 0) / 10_000,
      topCrops: cropRows.map((r) => ({ crop: r.crop, count: r.cnt })),
      attribution: this.attribution,
    };
  }

  private mapRow(row: FieldRow): Farmland {
    return {
      fieldId: row.field_id,
      polygonId: row.polygon_id,
      prefectureCode: row.prefecture_code,
      cityCode: row.city_code,
      address: row.address ?? "",
      centroid: { lat: row.centroid_lat, lng: row.centroid_lng },
      areaM2: row.area_m2,
      registeredCrop: row.registered_crop,
      attribution: this.attribution,
    };
  }
}

function clampLimit(n: number | undefined): number {
  if (!n || n <= 0) return DEFAULT_LIMIT;
  return Math.min(HARD_LIMIT, Math.floor(n));
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as {
      o?: number;
    };
    if (typeof decoded.o === "number" && decoded.o >= 0) return decoded.o;
  } catch {
    // fall through
  }
  return 0;
}
