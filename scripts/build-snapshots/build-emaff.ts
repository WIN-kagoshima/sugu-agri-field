import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";

interface BuilderResult {
  name: string;
  status: "ok" | "skipped" | "failed";
  message: string;
}

interface EmaffFeature {
  type: "Feature";
  properties: {
    field_id?: string;
    polygon_uuid?: string;
    polygon_id?: string;
    prefecture_code?: string;
    city_code?: string;
    local_government_cd?: string;
    address?: string;
    area_m2?: number;
    registered_crop?: string | null;
    land_type?: string | number | null;
    point_lat?: number;
    point_lng?: number;
  };
  geometry: {
    type: "Point" | "Polygon" | "MultiPolygon";
    coordinates: number[] | number[][][] | number[][][][];
  };
}

interface EmaffFeatureCollection {
  type: "FeatureCollection";
  features: EmaffFeature[];
}

export interface BuildEmaffOptions {
  rawPath?: string;
  rawPaths?: string[];
  outPath: string;
}

/**
 * Convert a GeoJSON dump of eMAFF Fude polygons into a queryable SQLite
 * snapshot with an R*Tree spatial index.
 *
 * Schema:
 *   CREATE TABLE field (
 *     rowid              INTEGER PRIMARY KEY,
 *     field_id           TEXT NOT NULL UNIQUE,
 *     polygon_id         TEXT NOT NULL,
 *     prefecture_code    TEXT NOT NULL,
 *     city_code          TEXT NOT NULL,
 *     address            TEXT,
 *     centroid_lat       REAL NOT NULL,
 *     centroid_lng       REAL NOT NULL,
 *     area_m2            REAL NOT NULL,
 *     registered_crop    TEXT
 *   );
 *
 *   CREATE VIRTUAL TABLE field_rtree USING rtree(
 *     id, minLat, maxLat, minLng, maxLng
 *   );
 *
 *   CREATE INDEX idx_field_pref ON field(prefecture_code);
 *   CREATE INDEX idx_field_city ON field(city_code);
 *   CREATE INDEX idx_field_crop ON field(registered_crop);
 */
export async function buildEmaffSnapshot(options: BuildEmaffOptions): Promise<BuilderResult> {
  const rawPaths = resolveRawPaths(options);
  const missingPaths = rawPaths.filter((path) => !existsSync(path));
  if (missingPaths.length > 0) {
    return {
      name: "emaff",
      status: "skipped",
      message: `Raw eMAFF GeoJSON not found at ${missingPaths.join(", ")}. Download the prefecture dataset from the official eMAFF open-data portal (https://open.fude.maff.go.jp/) and place the *.geojson there.`,
    };
  }

  const features = await readFeatures(rawPaths);

  const db = new Database(options.outPath);
  try {
    db.pragma("journal_mode = WAL");
    db.exec(`
      DROP TABLE IF EXISTS field_rtree;
      DROP TABLE IF EXISTS field;
      CREATE TABLE field (
        rowid              INTEGER PRIMARY KEY,
        field_id           TEXT NOT NULL UNIQUE,
        polygon_id         TEXT NOT NULL,
        prefecture_code    TEXT NOT NULL,
        city_code          TEXT NOT NULL,
        address            TEXT,
        centroid_lat       REAL NOT NULL,
        centroid_lng       REAL NOT NULL,
        area_m2            REAL NOT NULL,
        registered_crop    TEXT
      );
      CREATE VIRTUAL TABLE field_rtree USING rtree(
        id, minLat, maxLat, minLng, maxLng
      );
      CREATE INDEX idx_field_pref ON field(prefecture_code);
      CREATE INDEX idx_field_city ON field(city_code);
      CREATE INDEX idx_field_crop ON field(registered_crop);
    `);

    const insertField = db.prepare(`
      INSERT INTO field (field_id, polygon_id, prefecture_code, city_code,
                         address, centroid_lat, centroid_lng, area_m2, registered_crop)
      VALUES (@field_id, @polygon_id, @prefecture_code, @city_code,
              @address, @centroid_lat, @centroid_lng, @area_m2, @registered_crop)
    `);
    const insertRtree = db.prepare(`
      INSERT INTO field_rtree (id, minLat, maxLat, minLng, maxLng)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertAll = db.transaction((features: EmaffFeature[]) => {
      let count = 0;
      for (const f of features) {
        const props = f.properties ?? {};
        const localGovernmentCode = props.local_government_cd ?? props.city_code ?? "";
        const fieldId = props.field_id ?? props.polygon_uuid;
        const prefectureCode = props.prefecture_code ?? localGovernmentCode.slice(0, 2);
        if (!fieldId || !prefectureCode) continue;
        const centroid = computeCentroid(f.geometry);
        if (!centroid) continue;
        const info = insertField.run({
          field_id: fieldId,
          polygon_id: props.polygon_id ?? fieldId,
          prefecture_code: prefectureCode,
          city_code: props.city_code ?? localGovernmentCode,
          address: props.address ?? null,
          centroid_lat: props.point_lat ?? centroid.lat,
          centroid_lng: props.point_lng ?? centroid.lng,
          area_m2: props.area_m2 ?? 0,
          registered_crop: props.registered_crop ?? normalizeLandType(props.land_type),
        });
        const rowid = Number(info.lastInsertRowid);
        insertRtree.run(rowid, centroid.lat, centroid.lat, centroid.lng, centroid.lng);
        count += 1;
      }
      return count;
    });

    const inserted = insertAll(features);
    db.exec("ANALYZE");
    return {
      name: "emaff",
      status: "ok",
      message: `Wrote ${inserted} field(s) from ${rawPaths.length} GeoJSON file(s) to ${options.outPath}`,
    };
  } finally {
    db.close();
  }
}

function resolveRawPaths(options: BuildEmaffOptions): string[] {
  if (options.rawPaths && options.rawPaths.length > 0) return options.rawPaths;
  if (options.rawPath) return [options.rawPath];
  throw new Error("expected rawPath or rawPaths");
}

async function readFeatures(rawPaths: string[]): Promise<EmaffFeature[]> {
  const features: EmaffFeature[] = [];
  for (const rawPath of rawPaths) {
    const raw = await readFile(rawPath, "utf-8");
    const collection = JSON.parse(raw) as EmaffFeatureCollection;
    if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
      throw new Error(`expected a GeoJSON FeatureCollection at the top level: ${rawPath}`);
    }
    features.push(...collection.features);
  }
  return features;
}

function computeCentroid(geom: EmaffFeature["geometry"]): { lat: number; lng: number } | null {
  if (geom.type === "Point") {
    const c = geom.coordinates as number[];
    if (c.length < 2) return null;
    return { lng: c[0] as number, lat: c[1] as number };
  }
  if (geom.type === "Polygon") {
    const ring = (geom.coordinates as number[][][])[0];
    return centroidOfRing(ring);
  }
  if (geom.type === "MultiPolygon") {
    const polygon = (geom.coordinates as number[][][][])[0];
    const ring = polygon?.[0];
    return centroidOfRing(ring);
  }
  return null;
}

function centroidOfRing(ring: number[][] | undefined): { lat: number; lng: number } | null {
  if (!ring || ring.length === 0) return null;
  let lng = 0;
  let lat = 0;
  for (const point of ring) {
    lng += point[0] ?? 0;
    lat += point[1] ?? 0;
  }
  return { lng: lng / ring.length, lat: lat / ring.length };
}

function normalizeLandType(value: string | number | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value);
  if (text === "100") return "田";
  if (text === "200") return "畑";
  return text;
}
