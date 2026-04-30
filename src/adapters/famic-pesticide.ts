import { existsSync } from "node:fs";
import Database, { type Database as Db } from "better-sqlite3";
import { UpstreamError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import type { PesticideQueryResult, PesticideRule } from "../types/pesticide.js";
import type { FamicAdapter } from "./_interface.js";

const ATTRIBUTION = "Source: FAMIC 農薬登録情報 (open data)";
const DEFAULT_LIMIT = 20;
const HARD_LIMIT = 100;

export interface FamicSqliteOptions {
  path: string;
  logger?: Logger;
  attribution?: string;
}

interface PesticideRow {
  registration_id: string;
  product_name: string;
  active_ingredients: string;
  target_crops: string;
  target_pests: string;
  application_method: string | null;
  pre_harvest_interval_days: number | null;
  max_applications_per_season: number | null;
  registration_date: string | null;
  expires_at: string | null;
}

export class FamicSqliteAdapter implements FamicAdapter {
  private readonly db: Db;
  private readonly logger: Logger | undefined;
  private readonly attribution: string;

  constructor(options: FamicSqliteOptions) {
    if (!existsSync(options.path)) {
      throw new UpstreamError("famic-sqlite", `snapshot not found at ${options.path}`);
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
    crop?: string;
    pestOrDisease?: string;
    activeIngredient?: string;
    limit: number;
    cursor?: string;
  }): Promise<PesticideQueryResult> {
    const limit = clampLimit(input.limit);
    const offset = decodeCursor(input.cursor);
    const filters: string[] = [];
    const params: Record<string, string | number> = { limit, offset };

    if (input.crop) {
      filters.push("target_crops LIKE @crop");
      params.crop = `%${input.crop}%`;
    }
    if (input.pestOrDisease) {
      filters.push("target_pests LIKE @pest");
      params.pest = `%${input.pestOrDisease}%`;
    }
    if (input.activeIngredient) {
      filters.push("active_ingredients LIKE @ingredient");
      params.ingredient = `%${input.activeIngredient}%`;
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const sql = `
      SELECT registration_id, product_name, active_ingredients,
             target_crops, target_pests, application_method,
             pre_harvest_interval_days, max_applications_per_season,
             registration_date, expires_at
      FROM pesticide
      ${where}
      ORDER BY registration_id
      LIMIT @limit OFFSET @offset
    `;
    const rows = this.db.prepare<unknown[], PesticideRow>(sql).all(params) as PesticideRow[];
    const rules = rows.map((r) => this.mapRow(r));
    const nextCursor = rules.length === limit ? encodeCursor(offset + limit) : null;
    return {
      rules,
      nextCursor,
      attribution: this.attribution,
    };
  }

  async get(registrationId: string): Promise<PesticideRule | null> {
    const row = this.db
      .prepare<unknown[], PesticideRow>(
        `SELECT registration_id, product_name, active_ingredients,
                target_crops, target_pests, application_method,
                pre_harvest_interval_days, max_applications_per_season,
                registration_date, expires_at
         FROM pesticide WHERE registration_id = ?`,
      )
      .get(registrationId) as PesticideRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: PesticideRow): PesticideRule {
    return {
      registrationId: row.registration_id,
      productName: row.product_name,
      activeIngredients: splitList(row.active_ingredients),
      targetCrops: splitList(row.target_crops),
      targetPestsOrDiseases: splitList(row.target_pests),
      applicationMethod: row.application_method,
      preHarvestIntervalDays: row.pre_harvest_interval_days,
      maxApplicationsPerSeason: row.max_applications_per_season,
      registrationDate: row.registration_date,
      expiresAt: row.expires_at,
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

function splitList(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .split(/[,、|]/)
    .map((x) => x.trim())
    .filter(Boolean);
}
