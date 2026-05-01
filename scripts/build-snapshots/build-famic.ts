import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
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
  const rawInputs = await resolveRawInputs(options.rawPath);
  if (rawInputs.length === 0) {
    return {
      name: "famic",
      status: "skipped",
      message: `Raw FAMIC CSV not found at ${options.rawPath}. Download the latest pesticide registration export from FAMIC (https://www.acis.famic.go.jp/ddata/index2.htm) and place the official CSV there, or extract R*.csv files under snapshots/raw/famic*/.`,
    };
  }

  const rows = await readCsvInputs(rawInputs);
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
  const idx = (col: string, sourceHeader = header): number => {
    const i = sourceHeader.indexOf(col);
    if (i < 0) throw new Error(`missing required column: ${col}`);
    return i;
  };
  const optionalIdx = (col: string, sourceHeader = header): number => sourceHeader.indexOf(col);
  const hasColumns = (cols: string[]): boolean => cols.every((col) => header.includes(col));
  const normalizedRows = hasColumns([
    "registration_id",
    "product_name",
    "active_ingredients",
    "target_crops",
    "target_pests",
  ])
    ? rows
    : normalizeOfficialFamicRows(rows, idx);
  const normalizedHeader = normalizedRows[0];
  if (!normalizedHeader) {
    throw new Error("normalized CSV header missing");
  }
  const normalizedIdx = (col: string): number => idx(col, normalizedHeader);
  const normalizedOptionalIdx = (col: string): number => optionalIdx(col, normalizedHeader);
  const required = [
    "registration_id",
    "product_name",
    "active_ingredients",
    "target_crops",
    "target_pests",
  ];
  for (const r of required) normalizedIdx(r);

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
        registration_id: normalizedIdx("registration_id"),
        product_name: normalizedIdx("product_name"),
        active_ingredients: normalizedIdx("active_ingredients"),
        target_crops: normalizedIdx("target_crops"),
        target_pests: normalizedIdx("target_pests"),
        application_method: normalizedOptionalIdx("application_method"),
        pre_harvest_interval_days: normalizedOptionalIdx("pre_harvest_interval_days"),
        max_applications_per_season: normalizedOptionalIdx("max_applications_per_season"),
        registration_date: normalizedOptionalIdx("registration_date"),
        expires_at: normalizedOptionalIdx("expires_at"),
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

    const inserted = insertAll(normalizedRows.slice(1));
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

async function resolveRawInputs(rawPath: string): Promise<string[]> {
  if (existsSync(rawPath)) return [rawPath];
  const rawDir = dirname(rawPath);
  if (!existsSync(rawDir)) return [];
  const entries = await readdir(rawDir, { withFileTypes: true });
  const nestedDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith("famic"))
    .map((entry) => join(rawDir, entry.name));
  const out: string[] = [];
  for (const dir of nestedDirs) {
    const files = await readdir(dir, { withFileTypes: true });
    for (const file of files) {
      if (file.isFile() && /^R\d+\.csv$/i.test(file.name)) {
        out.push(join(dir, file.name));
      }
    }
  }
  return out.sort();
}

async function readCsvInputs(paths: string[]): Promise<string[][]> {
  const merged: string[][] = [];
  for (const path of paths) {
    const raw = await readText(path);
    const rows = parseCsv(raw);
    if (rows.length === 0) continue;
    if (merged.length === 0) {
      merged.push(...rows);
    } else {
      merged.push(...rows.slice(1));
    }
  }
  return merged;
}

async function readText(path: string): Promise<string> {
  const buffer = await readFile(path);
  const utf8 = buffer.toString("utf-8");
  if (utf8.includes("登録番号") || utf8.includes("registration_id")) return stripBom(utf8);
  return stripBom(new TextDecoder("shift_jis").decode(buffer));
}

function stripBom(input: string): string {
  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}

function normalizeOfficialFamicRows(rows: string[][], idx: (col: string) => number): string[][] {
  const header = rows[0];
  if (!header) {
    throw new Error("CSV header missing");
  }
  const indices = {
    registration_id: idx("登録番号"),
    product_name: idx("農薬の名称"),
    active_ingredients: idx("農薬の種類"),
    target_crops: idx("作物名"),
    target_pests: idx("適用病害虫雑草名"),
    application_method: idx("使用方法"),
    pre_harvest_interval_days: header.indexOf("使用時期"),
    max_applications_per_season: header.indexOf("本剤の使用回数"),
  };
  const grouped = new Map<string, OfficialFamicAggregate>();
  for (const row of rows.slice(1)) {
    const registrationId = row[indices.registration_id];
    if (!registrationId) continue;
    const existing = grouped.get(registrationId) ?? {
      registrationId,
      productName: row[indices.product_name] ?? "",
      activeIngredients: new Set<string>(),
      targetCrops: new Set<string>(),
      targetPests: new Set<string>(),
      applicationMethods: new Set<string>(),
      preHarvestIntervalDays: null,
      maxApplicationsPerSeason: null,
    };
    addListValue(existing.activeIngredients, row[indices.active_ingredients]);
    addListValue(existing.targetCrops, row[indices.target_crops]);
    addListValue(existing.targetPests, row[indices.target_pests]);
    addListValue(existing.applicationMethods, row[indices.application_method]);
    existing.preHarvestIntervalDays = minNullable(
      existing.preHarvestIntervalDays,
      parsePreHarvestIntervalDays(row[indices.pre_harvest_interval_days]),
    );
    existing.maxApplicationsPerSeason = maxNullable(
      existing.maxApplicationsPerSeason,
      parseJapaneseCount(row[indices.max_applications_per_season]),
    );
    grouped.set(registrationId, existing);
  }
  return [
    [
      "registration_id",
      "product_name",
      "active_ingredients",
      "target_crops",
      "target_pests",
      "application_method",
      "pre_harvest_interval_days",
      "max_applications_per_season",
      "registration_date",
      "expires_at",
    ],
    ...Array.from(grouped.values()).map((item) => [
      item.registrationId,
      item.productName,
      joinSet(item.activeIngredients),
      joinSet(item.targetCrops),
      joinSet(item.targetPests),
      joinSet(item.applicationMethods),
      item.preHarvestIntervalDays?.toString() ?? "",
      item.maxApplicationsPerSeason?.toString() ?? "",
      "",
      "",
    ]),
  ];
}

interface OfficialFamicAggregate {
  registrationId: string;
  productName: string;
  activeIngredients: Set<string>;
  targetCrops: Set<string>;
  targetPests: Set<string>;
  applicationMethods: Set<string>;
  preHarvestIntervalDays: number | null;
  maxApplicationsPerSeason: number | null;
}

function addListValue(values: Set<string>, value: string | undefined): void {
  if (!value) return;
  const trimmed = value.trim();
  if (trimmed) values.add(trimmed);
}

function joinSet(values: Set<string>): string {
  return Array.from(values).join("|");
}

function minNullable(current: number | null, next: number | null): number | null {
  if (next === null) return current;
  return current === null ? next : Math.min(current, next);
}

function maxNullable(current: number | null, next: number | null): number | null {
  if (next === null) return current;
  return current === null ? next : Math.max(current, next);
}

function parseJapaneseCount(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : null;
}

function parsePreHarvestIntervalDays(value: string | undefined): number | null {
  if (!value) return null;
  if (value.includes("前日")) return 1;
  if (value.includes("当日")) return 0;
  const days = value.match(/(\d+)\s*日/);
  if (days) return Number.parseInt(days[1] as string, 10);
  return null;
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
