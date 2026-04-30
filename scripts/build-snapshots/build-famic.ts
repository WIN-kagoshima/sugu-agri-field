import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import Database from "better-sqlite3";

interface BuilderResult {
  name: string;
  status: "ok" | "skipped" | "failed";
  message: string;
}

export interface BuildFamicOptions {
  rawPath: string;
  outPath: string;
}

/**
 * Convert a CSV dump of FAMIC pesticide registrations into a queryable
 * SQLite snapshot. The CSV layout is the official FAMIC export, with
 * | as the multi-value separator inside list columns.
 *
 * Required CSV columns (header order does not matter):
 *
 *   registration_id, product_name, active_ingredients,
 *   target_crops, target_pests, application_method,
 *   pre_harvest_interval_days, max_applications_per_season,
 *   registration_date, expires_at
 */
export async function buildFamicSnapshot(options: BuildFamicOptions): Promise<BuilderResult> {
  if (!existsSync(options.rawPath)) {
    return {
      name: "famic",
      status: "skipped",
      message: `Raw FAMIC CSV not found at ${options.rawPath}. Download the latest pesticide registration export from FAMIC (https://www.acis.famic.go.jp/) and place the *.csv there.`,
    };
  }

  const raw = await readFile(options.rawPath, "utf-8");
  const rows = parseCsv(raw);
  if (rows.length === 0) {
    return {
      name: "famic",
      status: "skipped",
      message: `${options.rawPath} contained no rows.`,
    };
  }
  const header = rows[0];
  if (!header) {
    throw new Error("CSV header missing");
  }
  const idx = (col: string): number => {
    const i = header.indexOf(col);
    if (i < 0) throw new Error(`missing required column: ${col}`);
    return i;
  };
  const required = [
    "registration_id",
    "product_name",
    "active_ingredients",
    "target_crops",
    "target_pests",
  ];
  for (const r of required) idx(r);

  const db = new Database(options.outPath);
  try {
    db.pragma("journal_mode = WAL");
    db.exec(`
      DROP TABLE IF EXISTS pesticide;
      CREATE TABLE pesticide (
        registration_id              TEXT PRIMARY KEY,
        product_name                 TEXT NOT NULL,
        active_ingredients           TEXT NOT NULL,
        target_crops                 TEXT NOT NULL,
        target_pests                 TEXT NOT NULL,
        application_method           TEXT,
        pre_harvest_interval_days    INTEGER,
        max_applications_per_season  INTEGER,
        registration_date            TEXT,
        expires_at                   TEXT
      );
      CREATE INDEX idx_pesticide_crops ON pesticide(target_crops);
      CREATE INDEX idx_pesticide_pests ON pesticide(target_pests);
      CREATE INDEX idx_pesticide_ingredients ON pesticide(active_ingredients);
    `);

    const insert = db.prepare(`
      INSERT OR REPLACE INTO pesticide (
        registration_id, product_name, active_ingredients,
        target_crops, target_pests, application_method,
        pre_harvest_interval_days, max_applications_per_season,
        registration_date, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertAll = db.transaction((dataRows: string[][]) => {
      const indices = {
        registration_id: idx("registration_id"),
        product_name: idx("product_name"),
        active_ingredients: idx("active_ingredients"),
        target_crops: idx("target_crops"),
        target_pests: idx("target_pests"),
        application_method: header.indexOf("application_method"),
        pre_harvest_interval_days: header.indexOf("pre_harvest_interval_days"),
        max_applications_per_season: header.indexOf("max_applications_per_season"),
        registration_date: header.indexOf("registration_date"),
        expires_at: header.indexOf("expires_at"),
      };
      let count = 0;
      for (const row of dataRows) {
        if (!row[indices.registration_id]) continue;
        insert.run(
          row[indices.registration_id],
          row[indices.product_name] ?? "",
          row[indices.active_ingredients] ?? "",
          row[indices.target_crops] ?? "",
          row[indices.target_pests] ?? "",
          opt(row, indices.application_method),
          optInt(row, indices.pre_harvest_interval_days),
          optInt(row, indices.max_applications_per_season),
          opt(row, indices.registration_date),
          opt(row, indices.expires_at),
        );
        count += 1;
      }
      return count;
    });

    const inserted = insertAll(rows.slice(1));
    db.exec("ANALYZE");
    return {
      name: "famic",
      status: "ok",
      message: `Wrote ${inserted} pesticide registration(s) to ${options.outPath}`,
    };
  } finally {
    db.close();
  }
}

function opt(row: string[], i: number): string | null {
  if (i < 0) return null;
  const v = row[i];
  return v === undefined || v === "" ? null : v;
}

function optInt(row: string[], i: number): number | null {
  const v = opt(row, i);
  if (v === null) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Minimal RFC 4180 CSV parser. Handles quoted fields with embedded
 * commas, double-quote escaping, and CRLF/LF line endings. Sufficient
 * for the FAMIC export format; intentionally not pulling in a heavier
 * library so the build script has zero non-stdlib runtime dependencies.
 */
function parseCsv(input: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    if (ch === "\n") {
      row.push(field);
      out.push(row);
      row = [];
      field = "";
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  return out.filter((r) => r.length > 0 && r.some((c) => c !== ""));
}
