import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { safeErrorMessage } from "../lib/errors.js";
import type { Deps } from "../server/deps.js";
import { getToolAnnotations } from "../server/surface-catalog.js";
import type { ToolMeta } from "../types/common.js";

export const meta: ToolMeta = {
  name: "open_dashboard",
  sideEffect: "read-only",
  visibility: "model",
  introducedInPhase: 5,
};

export const DASHBOARD_URI = "ui://sugu-agri/dashboard.html";

export const inputSchema = z
  .object({
    initialPrefectureCode: z
      .string()
      .regex(/^JP-\d{2}$/)
      .optional()
      .describe("ISO 3166-2:JP prefecture code to focus the map on, e.g. JP-46."),
    initialFieldId: z
      .string()
      .max(64)
      .optional()
      .describe("eMAFF field ID to highlight on first render."),
  })
  .strict();

/**
 * Phase 5 entry point: opens the MCP Apps UI dashboard.
 *
 * On hosts that support MCP Apps the result is rendered inline as a sandboxed
 * iframe. On hosts that do not, the `content[0].text` summary plus the
 * structured snapshot are still useful: this is the official Apps fallback
 * pattern.
 */
export function registerOpenDashboard(server: McpServer, deps: Deps): void {
  server.registerTool(
    meta.name,
    {
      title: "Open the SuguAgriField map dashboard",
      description:
        "Open the interactive map + weather dashboard. On MCP Apps hosts (Claude, ChatGPT) the UI renders inline; " +
        "on hosts without MCP Apps support a structured text summary is returned instead. Read-only.",
      inputSchema: inputSchema.shape,
      annotations: getToolAnnotations(meta.name),
      _meta: {
        "openai/widgetAccessible": true,
        "openai/outputTemplate": DASHBOARD_URI,
      },
    },
    async (raw: unknown) => {
      const parsed = inputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Invalid input: ${parsed.error.issues[0]?.message ?? "unknown"}`,
            },
          ],
        };
      }
      try {
        const initialState = {
          prefectureCode: parsed.data.initialPrefectureCode ?? "JP-46",
          fieldId: parsed.data.initialFieldId ?? null,
          attribution:
            "Map © OpenStreetMap contributors · Weather © Open-Meteo (CC-BY 4.0) · Farmland: 農林水産省 eMAFF 筆ポリゴン",
        };
        return {
          content: [
            {
              type: "text",
              text: `Opening the SuguAgriField dashboard${
                parsed.data.initialPrefectureCode
                  ? ` focused on ${parsed.data.initialPrefectureCode}`
                  : ""
              }.`,
            },
            {
              type: "resource_link",
              uri: DASHBOARD_URI,
              name: "SuguAgriField map dashboard",
              mimeType: "text/html",
            },
          ],
          structuredContent: initialState as unknown as Record<string, unknown>,
          _meta: {
            "openai/outputTemplate": DASHBOARD_URI,
          },
        };
      } catch (err) {
        deps.logger.error("open_dashboard failed", { error: (err as Error).message });
        return { isError: true, content: [{ type: "text", text: safeErrorMessage(err) }] };
      }
    },
  );
}
