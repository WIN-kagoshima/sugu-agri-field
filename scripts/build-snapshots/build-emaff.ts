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
    polygon_id?: string;
    prefecture_code?: string;
    city_code?: string;
    address?: string;
    area_m2?: number;
    registered_crop?: string | null;
  };
  geometry: {
    type: "Point" | "Polygon";
    coordinates: number[] | number[][][];
  };
}

interface EmaffFeatureCollection {
  type: "FeatureCollection";
  features: EmaffFeature[];
}

export interface BuildEmaffOptions {
  rawPath: string;
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
  if (!existsSync(options.rawPath)) {
    return {
      name: "emaff",
      status: "skipped",
      message: `Raw eMAFF GeoJSON not found at ${options.rawPath}. Download the prefecture dataset from the official eMAFF open-data portal (https://open.fude.maff.go.jp/) and place the *.geojson there.`,
    };
  }

  const raw = await readFile(options.rawPath, "utf-8");
  const collection = JSON.parse(raw) as EmaffFeatureCollection;
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error("expected a GeoJSON FeatureCollection at the top level");
  }

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
        if (!props.field_id || !props.prefecture_code) continue;
        const centroid = computeCentroid(f.geometry);
        if (!centroid) continue;
        const info = insertField.run({
          field_id: props.field_id,
          polygon_id: props.polygon_id ?? props.field_id,
          prefecture_code: props.prefecture_code,
          city_code: props.city_code ?? "",
          address: props.address ?? null,
          centroid_lat: centroid.lat,
          centroid_lng: centroid.lng,
          area_m2: props.area_m2 ?? 0,
          registered_crop: props.registered_crop ?? null,
        });
        const rowid = Number(info.lastInsertRowid);
        insertRtree.run(rowid, centroid.lat, centroid.lat, centroid.lng, centroid.lng);
        count += 1;
      }
      return count;
    });

    const inserted = insertAll(collection.features);
    db.exec("ANALYZE");
    return {
      name: "emaff",
      status: "ok",
      message: `Wrote ${inserted} field(s) to ${options.outPath}`,
    };
  } finally {
    db.close();
  }
}

function computeCentroid(geom: EmaffFeature["geometry"]): { lat: number; lng: number } | null {
  if (geom.type === "Point") {
    const c = geom.coordinates as number[];
    if (c.length < 2) return null;
    return { lng: c[0] as number, lat: c[1] as number };
  }
  if (geom.type === "Polygon") {
    const ring = (geom.coordinates as number[][][])[0];
    if (!ring || ring.length === 0) return null;
    let lng = 0;
    let lat = 0;
    for (const point of ring) {
      lng += point[0] ?? 0;
      lat += point[1] ?? 0;
    }
    return { lng: lng / ring.length, lat: lat / ring.length };
  }
  return null;
}
