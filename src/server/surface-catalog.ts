/**
 * Single source of truth for the *advertised* metadata of every tool,
 * prompt, and resource this server can expose.
 *
 * The Server Card (`/.well-known/mcp-server.json`) is built by
 * intersecting this catalog with the names that were actually registered
 * at runtime — so a Phase 0 deployment without an eMAFF snapshot does
 * NOT advertise `search_farmland` to registries that scrape the card.
 *
 * Adding a new tool / prompt / resource requires:
 *   1. An entry here with `introduced: "<semver>"` and a side-effect tag.
 *   2. Its `register*` call in `_registry.ts`.
 *   3. (For tools) `visibility: "model"` or `"app"` (Phase 5 split).
 *
 * The conformance test `tests/conformance/server-card.test.ts` enforces
 * that the catalog and the live `tools/list`, `prompts/list`,
 * `resources/list` agree on names.
 */

export type ToolSideEffect = "read-only" | "draft" | "mutating" | "destructive";
export type ToolVisibility = "model" | "app";

export interface ToolMetadata {
  sideEffect: ToolSideEffect;
  introduced: string;
  visibility: ToolVisibility;
}

export interface PromptMetadata {
  introduced: string;
}

export interface ResourceMetadata {
  title: string;
  introduced: string;
  mimeType: string;
}

export const TOOL_METADATA: Record<string, ToolMetadata> = {
  // ----- Phase 0 -----
  get_weather_1km: { sideEffect: "read-only", introduced: "0.1.0", visibility: "model" },
  // ----- Phase 1 -----
  get_weather_warning: { sideEffect: "read-only", introduced: "0.6.0", visibility: "model" },
  search_farmland: { sideEffect: "read-only", introduced: "0.1.0", visibility: "model" },
  area_summary: { sideEffect: "read-only", introduced: "0.1.0", visibility: "model" },
  nearby_farms: { sideEffect: "read-only", introduced: "0.1.0", visibility: "model" },
  get_pesticide_rules: { sideEffect: "read-only", introduced: "0.1.0", visibility: "model" },
  // ----- Phase 3 -----
  create_staff_deploy_plan: { sideEffect: "draft", introduced: "0.3.0", visibility: "model" },
  // ----- Phase 5 -----
  open_dashboard: { sideEffect: "read-only", introduced: "0.5.0", visibility: "model" },
  fetch_field_geojson: { sideEffect: "read-only", introduced: "0.5.0", visibility: "app" },
  fetch_weather_layer: { sideEffect: "read-only", introduced: "0.5.0", visibility: "app" },
  select_field: { sideEffect: "read-only", introduced: "0.5.0", visibility: "app" },
  list_prefectures: { sideEffect: "read-only", introduced: "0.5.0", visibility: "app" },
  list_municipalities: { sideEffect: "read-only", introduced: "0.5.0", visibility: "app" },
  search_operators: { sideEffect: "read-only", introduced: "0.5.0", visibility: "app" },
  summarize_farmland: { sideEffect: "read-only", introduced: "0.5.0", visibility: "app" },
  compute_ndvi_stub: { sideEffect: "read-only", introduced: "0.5.0", visibility: "app" },
  export_plan_csv: { sideEffect: "read-only", introduced: "0.5.0", visibility: "app" },
};

export const PROMPT_METADATA: Record<string, PromptMetadata> = {
  field_summary: { introduced: "0.2.0" },
  pesticide_advice: { introduced: "0.2.0" },
  staff_deploy_plan: { introduced: "0.2.0" },
  area_briefing: { introduced: "0.2.0" },
  weather_risk_alert: { introduced: "0.2.0" },
};

export const RESOURCE_METADATA: Record<string, ResourceMetadata> = {
  "ui://sugu-agri/dashboard.html": {
    title: "SuguAgriField map dashboard",
    introduced: "0.5.0",
    mimeType: "text/html",
  },
};

/**
 * Names actually registered with the live `McpServer`. Populated by the
 * `_registry.ts` collectors and consumed by `buildServerCard`.
 */
export interface RegisteredSurface {
  tools: string[];
  prompts: string[];
  resources: string[];
}

export function emptyRegisteredSurface(): RegisteredSurface {
  return { tools: [], prompts: [], resources: [] };
}
