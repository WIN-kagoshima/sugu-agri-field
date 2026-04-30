#!/usr/bin/env node
/**
 * SuguAgriField MCP server entry point.
 *
 *   node server.js --stdio   # stdio transport (default; for Claude Desktop, Cursor, VS Code)
 *   node server.js --http    # Streamable HTTP transport on $PORT (default 3001)
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./src/lib/config.js";
import { createLogger } from "./src/lib/logger.js";
import { createServer } from "./src/server/create-server.js";
import { startHttp } from "./src/server/transport-http.js";
import { startStdio } from "./src/server/transport-stdio.js";

interface PackageJson {
  name: string;
  version: string;
}

async function readVersion(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  // When running from dist/ the package.json sits one directory up.
  const candidates = [resolve(here, "package.json"), resolve(here, "..", "package.json")];
  for (const path of candidates) {
    try {
      const raw = await readFile(path, "utf-8");
      const pkg = JSON.parse(raw) as PackageJson;
      if (pkg.version) return pkg.version;
    } catch {
      // try next
    }
  }
  return "0.0.0";
}

function parseTransport(argv: string[]): "stdio" | "http" {
  if (argv.includes("--http")) return "http";
  if (argv.includes("--stdio")) return "stdio";
  return "stdio";
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, base: { service: "sugu-agri-field" } });
  const version = await readVersion();
  const transportKind = parseTransport(process.argv.slice(2));

  logger.info("starting", { version, transport: transportKind });

  const { server } = createServer({ config, logger, version });

  let stopHttp: (() => Promise<void>) | undefined;
  switch (transportKind) {
    case "stdio":
      await startStdio(server, logger);
      break;
    case "http": {
      const handle = await startHttp(server, { config, logger, version });
      stopHttp = handle.stop;
      break;
    }
    default: {
      const exhaustive: never = transportKind;
      throw new Error(`unsupported transport: ${String(exhaustive)}`);
    }
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      logger.warn("second shutdown signal received; forcing exit", { signal });
      process.exit(1);
    }
    shuttingDown = true;
    logger.info("shutdown", { signal });
    try {
      if (stopHttp) await stopHttp();
      await server.close();
    } catch (err) {
      logger.warn("shutdown error", { error: (err as Error).message });
    }
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  const e = err as Error;
  process.stderr.write(`fatal: ${e.message}\n`);
  if (e.stack) process.stderr.write(`${e.stack}\n`);
  process.exit(1);
});
