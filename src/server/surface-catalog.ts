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

/**
 * Subset of the MCP `ToolAnnotations` schema (Spec 2025-11-25 §6.10).
 *
 * Per spec these are **hints** clients may use to decide whether to require
 * confirmation before invoking a tool. They are *not* a security boundary —
 * a malicious server could lie. Hosts therefore typically combine these
 * hints with their own consent UI / origin trust.
 */
export interface ToolAnnotations {
  /** If `true`, the tool does not mutate its environment. */
  readOnlyHint: boolean;
  /** If `true`, repeated calls with the same arguments produce no additional effect. */
  idempotentHint: boolean;
  /**
   * If `true`, the tool may interact with systems outside the server's local
   * process (network, file system, side-effecting APIs).
   */
  openWorldHint: boolean;
  /** If `true`, the tool may delete or overwrite data. Implies `readOnlyHint: false`. */
  destructiveHint: boolean;
}

export interface ToolMetadata {
  sideEffect: ToolSideEffect;
  introduced: string;
  visibility: ToolVisibility;
  /**
   * Behaviour hints exposed to MCP clients via `tools/list`. Centralised here
   * so the Server Card, the live `tools/list`, and a conformance test all
   * agree on the same values.
   */
  annotations: ToolAnnotations;
}

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
  destructiveHint: false,
};

const READ_ONLY_REMOTE: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
  destructiveHint: false,
};

const DRAFT_NON_IDEMPOTENT: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: false,
  openWorldHint: false,
  destructiveHint: false,
};

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
  get_weather_1km: {
    sideEffect: "read-only",
    introduced: "0.1.0",
    visibility: "model",
    annotations: READ_ONLY_REMOTE,
  },
  // ----- Phase 1 -----
  get_weather_warning: {
    sideEffect: "read-only",
    introduced: "0.6.0",
    visibility: "model",
    annotations: READ_ONLY_REMOTE,
  },
  search_farmland: {
    sideEffect: "read-only",
    introduced: "0.1.0",
    visibility: "model",
    annotations: READ_ONLY,
  },
  area_summary: {
    sideEffect: "read-only",
    introduced: "0.1.0",
    visibility: "model",
    annotations: READ_ONLY,
  },
  nearby_farms: {
    sideEffect: "read-only",
    introduced: "0.1.0",
    visibility: "model",
    annotations: READ_ONLY,
  },
  get_pesticide_rules: {
    sideEffect: "read-only",
    introduced: "0.1.0",
    visibility: "model",
    annotations: READ_ONLY,
  },
  // ----- Phase 3 -----
  create_staff_deploy_plan: {
    sideEffect: "draft",
    introduced: "0.3.0",
    visibility: "model",
    annotations: DRAFT_NON_IDEMPOTENT,
  },
  // ----- Phase 5 -----
  open_dashboard: {
    sideEffect: "read-only",
    introduced: "0.5.0",
    visibility: "model",
    annotations: READ_ONLY,
  },
  fetch_field_geojson: {
    sideEffect: "read-only",
    introduced: "0.5.0",
    visibility: "app",
    annotations: READ_ONLY,
  },
  fetch_weather_layer: {
    sideEffect: "read-only",
    introduced: "0.5.0",
    visibility: "app",
    annotations: READ_ONLY_REMOTE,
  },
  select_field: {
    sideEffect: "read-only",
    introduced: "0.5.0",
    visibility: "app",
    annotations: READ_ONLY,
  },
  list_prefectures: {
    sideEffect: "read-only",
    introduced: "0.5.0",
    visibility: "app",
    annotations: READ_ONLY,
  },
  list_municipalities: {
    sideEffect: "read-only",
    introduced: "0.5.0",
    visibility: "app",
    annotations: READ_ONLY,
  },
  search_operators: {
    sideEffect: "read-only",
    introduced: "0.5.0",
    visibility: "app",
    annotations: READ_ONLY,
  },
  summarize_farmland: {
    sideEffect: "read-only",
    introduced: "0.5.0",
    visibility: "app",
    annotations: READ_ONLY,
  },
  compute_ndvi_stub: {
    sideEffect: "read-only",
    introduced: "0.5.0",
    visibility: "app",
    annotations: READ_ONLY,
  },
  export_plan_csv: {
    sideEffect: "read-only",
    introduced: "0.5.0",
    visibility: "app",
    annotations: READ_ONLY,
  },
};

/**
 * Returns the spec-compliant `ToolAnnotations` for a tool. Throws if the
 * caller supplies a name that is not in `TOOL_METADATA` — register tools
 * via this helper so the catalog cannot drift from the live registration.
 */
export function getToolAnnotations(name: string): ToolAnnotations {
  const meta = TOOL_METADATA[name];
  if (!meta) {
    throw new Error(
      `getToolAnnotations: tool "${name}" missing from TOOL_METADATA in surface-catalog.ts`,
    );
  }
  return meta.annotations;
}

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
