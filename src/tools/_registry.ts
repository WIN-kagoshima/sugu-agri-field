import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../server/deps.js";
import {
  registerComputeNdviStub,
  registerExportPlanCsv,
  registerFetchFieldGeojson,
  registerFetchWeatherLayer,
  registerListMunicipalities,
  registerListPrefectures,
  registerSearchOperators,
  registerSelectField,
  registerSummarizeFarmland,
} from "./app-only/index.js";
import { registerAreaSummary } from "./area-summary.js";
import { registerCreateStaffDeployPlan } from "./create-staff-deploy-plan.js";
import { registerGetPesticideRules } from "./get-pesticide-rules.js";
import { registerGetWeather1km } from "./get-weather-1km.js";
import { registerGetWeatherWarning } from "./get-weather-warning.js";
import { registerNearbyFarms } from "./nearby-farms.js";
import { registerOpenDashboard } from "./open-dashboard.js";
import { registerSearchFarmland } from "./search-farmland.js";

/**
 * Single source of truth for tool registration.
 *
 * Tools are registered conditionally on the deps that are present, so a
 * Phase 0 server (no eMAFF) only exposes weather. This keeps the LLM
 * context lean and avoids "tool exists but always errors" UX.
 *
 * Returns the names of tools that were actually registered, so the
 * Server Card builder can advertise only what is live.
 */
export function registerAllTools(server: McpServer, deps: Deps): string[] {
  const registered: string[] = [];
  const reg = (name: string, fn: () => void) => {
    fn();
    registered.push(name);
  };

  // ----- Phase 0 -----
  reg("get_weather_1km", () => registerGetWeather1km(server, deps));

  // ----- Phase 1 — JMA warnings; cheap to mount unconditionally because
  //                 the adapter only goes upstream when the tool is called. -----
  if (deps.jma) {
    reg("get_weather_warning", () => registerGetWeatherWarning(server, deps));
  }

  // ----- Phase 1 — only when eMAFF / FAMIC adapters are configured -----
  if (deps.emaff) {
    reg("search_farmland", () => registerSearchFarmland(server, deps));
    reg("area_summary", () => registerAreaSummary(server, deps));
    reg("nearby_farms", () => registerNearbyFarms(server, deps));
  }
  if (deps.famic) {
    reg("get_pesticide_rules", () => registerGetPesticideRules(server, deps));
  }

  // ----- Phase 3 (uses Form elicitation, falls back when client lacks it) -----
  if (deps.emaff) {
    reg("create_staff_deploy_plan", () => registerCreateStaffDeployPlan(server, deps));
  }

  // ----- Phase 5 — MCP Apps UI dashboard -----
  reg("open_dashboard", () => registerOpenDashboard(server, deps));

  // ----- Phase 5 app-only helpers (LLM-invisible) -----
  if (deps.emaff) {
    reg("fetch_field_geojson", () => registerFetchFieldGeojson(server, deps));
    reg("select_field", () => registerSelectField(server, deps));
    reg("list_prefectures", () => registerListPrefectures(server, deps));
    reg("list_municipalities", () => registerListMunicipalities(server, deps));
    reg("search_operators", () => registerSearchOperators(server, deps));
    reg("summarize_farmland", () => registerSummarizeFarmland(server, deps));
    reg("compute_ndvi_stub", () => registerComputeNdviStub(server, deps));
  }
  reg("fetch_weather_layer", () => registerFetchWeatherLayer(server, deps));
  reg("export_plan_csv", () => registerExportPlanCsv(server, deps));

  return registered;
}
