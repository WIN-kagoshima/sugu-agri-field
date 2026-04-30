/**
 * App-only tools (Phase 5).
 *
 * These tools are called by the MCP Apps UI dashboard, NOT by the LLM. They
 * are registered with `_meta.ui.visibility: ["app"]` so MCP hosts that
 * respect the visibility hint hide them from the model's tool list.
 *
 * Why split: the LLM's context budget should be spent on the 7 model-visible
 * tools that match user intent. UI plumbing (geojson fetch, viewport
 * filtering, CSV export) does not need the LLM's attention.
 */

export { registerFetchFieldGeojson } from "./fetch-field-geojson.js";
export { registerFetchWeatherLayer } from "./fetch-weather-layer.js";
export { registerSelectField } from "./select-field.js";
export { registerListPrefectures } from "./list-prefectures.js";
export { registerListMunicipalities } from "./list-municipalities.js";
export { registerSearchOperators } from "./search-operators.js";
export { registerExportPlanCsv } from "./export-plan-csv.js";
export { registerSummarizeFarmland } from "./summarize-farmland.js";
export { registerComputeNdviStub } from "./compute-ndvi-stub.js";
