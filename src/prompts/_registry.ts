import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Deps } from "../server/deps.js";
import { registerAreaBriefingPrompt } from "./area-briefing.js";
import { registerFieldSummaryPrompt } from "./field-summary.js";
import { registerPesticideAdvicePrompt } from "./pesticide-advice.js";
import { registerStaffDeployPlanPrompt } from "./staff-deploy-plan.js";
import { registerWeatherRiskAlertPrompt } from "./weather-risk-alert.js";

/**
 * Phase 2: 5 user-controlled prompts (slash commands). They are exposed
 * unconditionally; the underlying tools they reference may not be available
 * in early phases, in which case the prompt simply tells the LLM to
 * apologise and explain what is missing.
 *
 * Returns the names of registered prompts for Server Card consumption.
 */
export function registerAllPrompts(server: McpServer, deps: Deps): string[] {
  registerFieldSummaryPrompt(server, deps);
  registerPesticideAdvicePrompt(server, deps);
  registerStaffDeployPlanPrompt(server, deps);
  registerAreaBriefingPrompt(server, deps);
  registerWeatherRiskAlertPrompt(server, deps);
  return [
    "field_summary",
    "pesticide_advice",
    "staff_deploy_plan",
    "area_briefing",
    "weather_risk_alert",
  ];
}
