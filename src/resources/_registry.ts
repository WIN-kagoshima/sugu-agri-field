import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../server/deps.js";
import { registerDashboardUiResource } from "./dashboard-ui.js";

/**
 * MCP resources exposed by this server.
 *
 * Phase 5 introduces `ui://agriops/dashboard.html` — the MCP Apps UI
 * resource. Earlier phases register no resources by default but the
 * registration function is called regardless so that adding new ones is
 * a single line change.
 *
 * Returns the URIs of registered resources for Server Card consumption.
 */
export function registerAllResources(server: McpServer, deps: Deps): string[] {
  registerDashboardUiResource(server, deps);
  return ["ui://agriops/dashboard.html"];
}
