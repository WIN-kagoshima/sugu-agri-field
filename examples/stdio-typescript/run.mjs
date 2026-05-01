// @ts-check
/**
 * Minimal TypeScript / Node stdio client for AgriOps MCP.
 *
 * Usage:
 *   node ./run.mjs                  # uses ../../dist/server.js
 *   node ./run.mjs path/to/server   # custom server entrypoint
 */

import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverEntry = resolve(
  process.argv[2] ?? new URL("../../dist/server.js", import.meta.url).pathname,
);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverEntry, "--stdio"],
});

const client = new Client({ name: "agriops-mcp-example", version: "0.0.1" }, { capabilities: {} });

await client.connect(transport);

const info = client.getServerVersion();
console.log(`✓ Connected to ${info?.name ?? "<unknown>"} v${info?.version ?? "?"}`);

const tools = await client.listTools();
console.log(`✓ Tools: ${tools.tools.map((t) => t.name).join(", ")}`);

const result = await client.callTool({
  name: "get_weather_1km",
  arguments: {
    lat: 31.55,
    lng: 130.55,
    hours: 24,
    timezone: "Asia/Tokyo",
  },
});

if (result.isError) {
  const text = result.content[0] && "text" in result.content[0] ? result.content[0].text : "";
  console.error("✗ Tool failed:", text);
  process.exit(1);
}

const sc = result.structuredContent;
console.log(`✓ Forecast: ${sc?.hourly?.length ?? 0} hourly points`);
const attribution = result.content
  .map((c) => ("text" in c ? c.text : null))
  .filter(Boolean)
  .pop();
console.log(`✓ Attribution: ${attribution ?? "(missing)"}`);

await client.close();
