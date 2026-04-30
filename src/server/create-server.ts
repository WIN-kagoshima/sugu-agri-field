import { existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { EmaffSqliteAdapter } from "../adapters/emaff-fude.js";
import { FamicSqliteAdapter } from "../adapters/famic-pesticide.js";
import { JmaWarningAdapter } from "../adapters/weather/jma-warning.js";
import { OpenMeteoWeatherAdapter } from "../adapters/weather/open-meteo.js";
import { InMemoryTokenStore } from "../auth/token-store.js";
import { InMemoryElicitationStore } from "../elicitation/store.js";
import type { Config } from "../lib/config.js";
import type { Logger } from "../lib/logger.js";
import { registerAllPrompts } from "../prompts/_registry.js";
import { registerAllResources } from "../resources/_registry.js";
import { registerAllTools } from "../tools/_registry.js";
import type { Deps } from "./deps.js";
import { type RegisteredSurface, emptyRegisteredSurface } from "./surface-catalog.js";

const SERVER_NAME = "sugu-agri-field";

export interface CreateServerOptions {
  config: Config;
  logger: Logger;
  version: string;
  /** Override individual deps in tests. */
  overrides?: Partial<Deps>;
}

/**
 * Build a fully-wired MCP server. Pure factory: no transport, no listening,
 * no global side effects. The caller picks stdio or Streamable HTTP and
 * connects the returned server.
 */
export function createServer(options: CreateServerOptions): {
  server: McpServer;
  deps: Deps;
  surface: RegisteredSurface;
} {
  const { config, logger, version, overrides } = options;

  const emaff =
    overrides?.emaff !== undefined
      ? overrides.emaff
      : existsSync(config.emaffSnapshotPath)
        ? new EmaffSqliteAdapter({
            path: config.emaffSnapshotPath,
            logger: logger.child({ component: "emaff" }),
          })
        : null;

  const famic =
    overrides?.famic !== undefined
      ? overrides.famic
      : existsSync(config.famicSnapshotPath)
        ? new FamicSqliteAdapter({
            path: config.famicSnapshotPath,
            logger: logger.child({ component: "famic" }),
          })
        : null;

  const deps: Deps = {
    config,
    logger,
    version,
    bootedAt: new Date().toISOString(),
    weather:
      overrides?.weather ??
      new OpenMeteoWeatherAdapter({
        baseUrl: config.openMeteoBaseUrl,
        logger: logger.child({ component: "open-meteo" }),
      }),
    jma:
      overrides?.jma !== undefined
        ? overrides.jma
        : new JmaWarningAdapter({
            logger: logger.child({ component: "jma" }),
          }),
    emaff,
    famic,
    tokenStore: overrides?.tokenStore ?? new InMemoryTokenStore(),
    elicitationStore: overrides?.elicitationStore ?? new InMemoryElicitationStore(),
  };

  if (!emaff) {
    logger.info("eMAFF snapshot not found — farmland tools disabled", {
      path: config.emaffSnapshotPath,
    });
  }
  if (!famic) {
    logger.info("FAMIC snapshot not found — pesticide tool disabled", {
      path: config.famicSnapshotPath,
    });
  }

  const server = new McpServer(
    {
      name: SERVER_NAME,
      version,
      title: "SuguAgriField",
      description:
        "Japanese agricultural data (farmland, weather, pesticides) for SSW workforce dispatching. Reference MCP server (Apache-2.0).",
      websiteUrl: "https://github.com/WIN-kagoshima/sugu-agri-field",
    },
    {
      capabilities: {
        tools: { listChanged: true },
        prompts: { listChanged: true },
        resources: { listChanged: true, subscribe: false },
        logging: {},
      },
      instructions: [
        "This server exposes Japanese agricultural data — farmland polygons (eMAFF), 1 km mesh weather (Open-Meteo), and pesticide registrations (FAMIC).",
        "Cross-tool patterns: use `search_farmland` to get a `field_id`, then `get_weather_1km` with the field's centroid for site-specific weather, then `get_pesticide_rules` for the registered crop.",
        "All data sources include a license attribution string in `structuredContent.attribution`. Surface it when summarising the data to end users.",
        "Pre-1.0 the surface is experimental: tool names and shapes may change between minor versions.",
      ].join(" "),
    },
  );

  const surface: RegisteredSurface = emptyRegisteredSurface();
  surface.tools = registerAllTools(server, deps);
  surface.prompts = registerAllPrompts(server, deps);
  surface.resources = registerAllResources(server, deps);

  return { server, deps, surface };
}
