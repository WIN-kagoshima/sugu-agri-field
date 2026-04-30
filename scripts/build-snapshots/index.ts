#!/usr/bin/env node
/**
 * Reproducible snapshot builder.
 *
 * Reads raw open-data files under `snapshots/raw/` and produces SQLite
 * snapshots that the runtime adapters consume. Run with:
 *
 *     npm run snapshots:build
 *
 * Each builder is idempotent and independent: missing raw inputs cause
 * that builder to print an instructive message and skip, rather than fail
 * the whole pipeline. This lets developers run only the parts they care
 * about.
 */

import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { buildEmaffSnapshot } from "./build-emaff.js";
import { buildFamicSnapshot } from "./build-famic.js";

interface BuilderResult {
  name: string;
  status: "ok" | "skipped" | "failed";
  message: string;
}

async function ensureDir(path: string): Promise<void> {
  if (!existsSync(path)) {
    await mkdir(path, { recursive: true });
  }
}

async function run(): Promise<void> {
  await ensureDir("./snapshots");
  await ensureDir("./snapshots/raw");

  const results: BuilderResult[] = [];

  results.push(
    await tryRun("emaff", () =>
      buildEmaffSnapshot({
        rawPath: "./snapshots/raw/emaff-fude-kagoshima.geojson",
        outPath: "./snapshots/emaff-fude-kagoshima.sqlite",
      }),
    ),
  );
  results.push(
    await tryRun("famic", () =>
      buildFamicSnapshot({
        rawPath: "./snapshots/raw/famic-pesticide.csv",
        outPath: "./snapshots/famic-pesticide-2026.sqlite",
      }),
    ),
  );

  console.log("\n=== Snapshot build summary ===");
  for (const r of results) {
    const icon = r.status === "ok" ? "OK" : r.status === "skipped" ? "--" : "FAIL";
    console.log(`[${icon}] ${r.name}: ${r.message}`);
  }
  if (results.some((r) => r.status === "failed")) {
    process.exitCode = 1;
  }
}

async function tryRun(name: string, fn: () => Promise<BuilderResult>): Promise<BuilderResult> {
  try {
    const out = await fn();
    return out;
  } catch (err) {
    return {
      name,
      status: "failed",
      message: (err as Error).message,
    };
  }
}

run().catch((err: unknown) => {
  const e = err as Error;
  console.error(`fatal: ${e.message}`);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});

// Re-export for tests.
export { dirname };
