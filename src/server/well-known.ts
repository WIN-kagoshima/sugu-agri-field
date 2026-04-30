import type { Express, Request, Response } from "express";
import {
  PROMPT_METADATA,
  RESOURCE_METADATA,
  type RegisteredSurface,
  TOOL_METADATA,
} from "./surface-catalog.js";

export interface WellKnownOptions {
  baseUrl: string;
  version: string;
  /**
   * The surface that the live server actually registered. The card filters
   * `TOOL_METADATA` / `PROMPT_METADATA` / `RESOURCE_METADATA` to this set
   * so a Phase 0 deployment without eMAFF does not advertise farmland tools.
   */
  surface: RegisteredSurface;
}

/**
 * Build the `.well-known/mcp-server.json` Server Card.
 *
 * Aligned with the MCP 2026 roadmap (Server Cards / discovery): a static,
 * cacheable JSON document that registries and crawlers can fetch with no
 * authentication and no live MCP session.
 *
 * IMPORTANT: change here = change to the public surface. Bump `version`
 * and update CHANGELOG.md.
 */
export function buildServerCard(options: WellKnownOptions): Record<string, unknown> {
  const tools = options.surface.tools
    .filter((name) => TOOL_METADATA[name])
    .map((name) => {
      const meta = TOOL_METADATA[name];
      if (!meta) throw new Error(`internal: missing TOOL_METADATA for ${name}`);
      return {
        name,
        sideEffect: meta.sideEffect,
        introduced: meta.introduced,
        visibility: meta.visibility,
      };
    });

  const prompts = options.surface.prompts
    .filter((name) => PROMPT_METADATA[name])
    .map((name) => {
      const meta = PROMPT_METADATA[name];
      if (!meta) throw new Error(`internal: missing PROMPT_METADATA for ${name}`);
      return { name, introduced: meta.introduced };
    });

  const apps = options.surface.resources
    .filter((uri) => uri.startsWith("ui://") && RESOURCE_METADATA[uri])
    .map((uri) => {
      const meta = RESOURCE_METADATA[uri];
      if (!meta) throw new Error(`internal: missing RESOURCE_METADATA for ${uri}`);
      return { uri, title: meta.title, introduced: meta.introduced };
    });

  return {
    name: "SuguAgriField",
    version: options.version,
    description:
      "Japanese agricultural land + 1 km mesh weather + pesticide registration MCP server " +
      "for Specified Skilled Worker (SSW) workforce dispatching. Reference implementation of " +
      "MCP Spec 2025-11-25 + MCP Apps Extension 2026-01-26.",
    homepage: "https://github.com/WIN-kagoshima/sugu-agri-field",
    repository: "https://github.com/WIN-kagoshima/sugu-agri-field",
    license: "Apache-2.0",
    contact: {
      issues: "https://github.com/WIN-kagoshima/sugu-agri-field/issues",
      security: "security@sugukuru.dev",
    },
    endpoints: {
      mcp: `${options.baseUrl}/mcp`,
      health: `${options.baseUrl}/healthz`,
    },
    capabilities: {
      tools: { listChanged: true },
      prompts: { listChanged: true },
      resources: { listChanged: true, subscribe: false },
      logging: {},
    },
    transports: ["streamable-http"],
    languages: ["ja", "en"],
    tools,
    prompts,
    apps,
    data_sources: [
      {
        name: "eMAFF Fude Polygon",
        license: "open-data",
        attribution: "農林水産省 eMAFF 筆ポリゴン",
      },
      { name: "Open-Meteo", license: "CC-BY-4.0", attribution: "Open-Meteo.com" },
      {
        name: "JMA Disaster XML feed",
        license: "Japan Meteorological Business Act",
        attribution: "気象庁",
      },
      {
        name: "FAMIC pesticide registration",
        license: "open-data",
        attribution: "FAMIC 農薬登録情報",
      },
    ],
    spec: {
      core: "2025-11-25",
      apps: "2026-01-26",
    },
    experimental: true,
  };
}

export function mountWellKnown(app: Express, options: WellKnownOptions): void {
  const card = buildServerCard(options);
  const body = JSON.stringify(card, null, 2);
  app.get("/.well-known/mcp-server.json", (_req: Request, res: Response) => {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "public, max-age=300");
    res.status(200).send(body);
  });
}
