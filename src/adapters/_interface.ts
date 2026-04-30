/**
 * Adapter interfaces. The tool layer depends on these, never on concrete classes.
 *
 * Adding a new data source = implement an interface, register it in
 * `src/server/deps.ts`. Tools do not change.
 */

import type { LatLng } from "../lib/geo.js";
import type { AreaSummary, Farmland, FarmlandSearchResult } from "../types/farmland.js";
import type { PesticideQueryResult, PesticideRule } from "../types/pesticide.js";
import type { WeatherForecast } from "../types/weather.js";

// ----- Weather -----

export interface WeatherAdapter {
  /** Hourly forecast for the given coordinates. Implementations cache for ≥1 hour. */
  getForecast(input: {
    lat: number;
    lng: number;
    hours: number;
    timezone?: string;
  }): Promise<WeatherForecast>;
}

// ----- Farmland (eMAFF) -----

export interface EmaffAdapter {
  search(input: {
    query?: string;
    prefectureCode?: string;
    cityCode?: string;
    crop?: string;
    limit: number;
    cursor?: string;
  }): Promise<FarmlandSearchResult>;

  get(fieldId: string): Promise<Farmland | null>;

  nearby(center: LatLng, radiusMeters: number, limit: number): Promise<FarmlandSearchResult>;

  areaSummary(input: {
    prefectureCode?: string;
    cityCode?: string;
  }): Promise<AreaSummary>;
}

// ----- Weather warnings (JMA) -----

export interface JmaWarning {
  /** ISO 3166-2:JP prefecture code (`JP-46` for 鹿児島県). */
  prefectureCode: string;
  /** Free-form Japanese area label (e.g. "鹿児島県本土"). */
  areaName: string;
  /** Spec-defined warning kind (e.g. "大雨警報", "高温注意情報"). */
  kind: string;
  /** Severity ladder per Spec: `特別警報` > `警報` > `注意報` > `情報`. */
  severity: "tokubetsu" | "warning" | "advisory" | "info";
  /** Issuer-reported issuance time. */
  issuedAt: string;
  /** Source XML URL on jma.go.jp; the LLM must NOT click it, but ops can. */
  sourceUrl: string;
  /** Optional headline body. */
  headline: string | null;
}

export interface JmaAdapter {
  /**
   * Fetch active warnings/advisories for a prefecture (or nationwide if
   * `prefectureCode` is omitted). Implementations MUST cap cache TTL at
   * ≤10 minutes to stay within the Japan Meteorological Business Act
   * fair-use guidance.
   */
  getActiveWarnings(input: { prefectureCode?: string }): Promise<{
    warnings: JmaWarning[];
    fetchedAt: string;
    /** Required attribution string baked into every result. */
    attribution: string;
  }>;
}

// ----- Pesticide (FAMIC) -----

export interface FamicAdapter {
  search(input: {
    crop?: string;
    pestOrDisease?: string;
    activeIngredient?: string;
    limit: number;
    cursor?: string;
  }): Promise<PesticideQueryResult>;

  get(registrationId: string): Promise<PesticideRule | null>;
}
