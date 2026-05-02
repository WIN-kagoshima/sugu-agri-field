interface Options {
  baseUrl?: string;
  allowNotReady: boolean;
  authBearer?: string;
  healthPath: string;
  metricsBearer?: string;
}

interface SmokeResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface RpcResponse {
  status: number;
  contentType: string;
  text: string;
  parsed?: unknown;
}

function parseArgs(argv: string[]): Options {
  const options: Options = { allowNotReady: false, healthPath: "/healthz" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]?.trim();
    if (arg === undefined || arg === "") continue;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--allow-not-ready") {
      options.allowNotReady = true;
      continue;
    }
    const eq = arg.indexOf("=");
    const key = (eq >= 0 ? arg.slice(0, eq) : arg).trim();
    const inlineValue = eq >= 0 ? arg.slice(eq + 1).trim() : undefined;
    const next = inlineValue ?? argv[i + 1]?.trim();
    if (next === undefined || next === "" || next.startsWith("--")) {
      throw new Error(`Missing value for ${key}`);
    }
    switch (key) {
      case "--base-url":
        options.baseUrl = next;
        if (inlineValue === undefined) i++;
        break;
      case "--auth-bearer":
        options.authBearer = next;
        if (inlineValue === undefined) i++;
        break;
      case "--health-path":
        options.healthPath = next.startsWith("/") ? next : `/${next}`;
        if (inlineValue === undefined) i++;
        break;
      case "--metrics-bearer":
        options.metricsBearer = next;
        if (inlineValue === undefined) i++;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`AgriOps MCP deployed-service smoke test

Usage:
  npm run deploy:smoke -- --base-url https://SERVICE-xyz.a.run.app

Options:
  --base-url <url>        Public base URL of the deployed server.
  --allow-not-ready       Treat /readyz 503 as a warning (useful before snapshots exist).
  --auth-bearer <tok>     Send this bearer token to all smoke-test requests.
  --health-path <path>    Liveness path to check. Default: /healthz.
  --metrics-bearer <tok>  Also check /metrics using this bearer token.
`);
}

function normalizeBaseUrl(input: string): string {
  const url = new URL(input);
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

async function fetchText(
  url: string,
  init?: RequestInit,
): Promise<{
  status: number;
  contentType: string;
  text: string;
}> {
  const res = await fetch(url, init);
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    text: await res.text(),
  };
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("event:") || trimmed.startsWith("data:")) {
    const dataLines = trimmed
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .filter(Boolean);
    if (dataLines.length > 0) return JSON.parse(dataLines.join("\n"));
  }
  return JSON.parse(trimmed);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function result(name: string, ok: boolean, detail: string): SmokeResult {
  return { name, ok, detail };
}

function resultObject(parsed: unknown): Record<string, unknown> {
  if (!isRecord(parsed)) return {};
  return isRecord(parsed.result) ? parsed.result : parsed;
}

async function callRpc(
  baseUrl: string,
  method: string,
  params: Record<string, unknown>,
  id: number,
  headers?: Record<string, string>,
): Promise<RpcResponse> {
  const response = await fetchText(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      ...headers,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "x-request-id": `deploy-smoke-${method.replace("/", "-")}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  });
  try {
    return { ...response, parsed: parseJson(response.text) };
  } catch {
    return response;
  }
}

function namesFromList(parsed: unknown, key: "tools" | "prompts" | "resources"): string[] {
  const response = resultObject(parsed);
  const items = Array.isArray(response[key]) ? response[key] : [];
  return items
    .filter(isRecord)
    .map((item) => String(key === "resources" ? item.uri : item.name))
    .filter(Boolean)
    .sort();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.baseUrl) {
    throw new Error(
      "--base-url is required. Example: npm run deploy:smoke -- --base-url https://...",
    );
  }
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const results: SmokeResult[] = [];
  const defaultHeaders = options.authBearer
    ? { authorization: `Bearer ${options.authBearer}` }
    : undefined;

  const health = await fetchText(`${baseUrl}${options.healthPath}`, { headers: defaultHeaders });
  results.push(
    result(
      options.healthPath,
      health.status === 200,
      `status=${health.status}, body=${health.text.slice(0, 200)}`,
    ),
  );

  const ready = await fetchText(`${baseUrl}/readyz`, { headers: defaultHeaders });
  results.push(
    result(
      "/readyz",
      ready.status === 200 || (options.allowNotReady && ready.status === 503),
      `status=${ready.status}, body=${ready.text.slice(0, 300)}`,
    ),
  );

  const card = await fetchText(`${baseUrl}/.well-known/mcp-server.json`, {
    headers: defaultHeaders,
  });
  let cardOk = false;
  let cardDetail = `status=${card.status}`;
  try {
    const parsed = parseJson(card.text);
    if (isRecord(parsed)) {
      const endpoints = isRecord(parsed.endpoints) ? parsed.endpoints : {};
      cardOk =
        card.status === 200 &&
        parsed.name === "AgriOps MCP" &&
        parsed.version !== undefined &&
        endpoints.mcp === `${baseUrl}/mcp`;
      cardDetail = `status=${card.status}, name=${String(parsed.name)}, mcp=${String(endpoints.mcp)}`;
    }
  } catch (error) {
    cardDetail = `status=${card.status}, parse_error=${(error as Error).message}`;
  }
  results.push(result("Server Card", cardOk, cardDetail));

  const initialize = await callRpc(
    baseUrl,
    "initialize",
    {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "agriops-deploy-smoke", version: "0.0.1" },
    },
    1,
    defaultHeaders,
  );
  let initOk = false;
  let initDetail = `status=${initialize.status}`;
  if (initialize.parsed !== undefined) {
    const response = resultObject(initialize.parsed);
    const serverInfo = isRecord(response.serverInfo) ? response.serverInfo : {};
    initOk = initialize.status === 200 && serverInfo.name === "agriops-mcp";
    initDetail = `status=${initialize.status}, server=${String(serverInfo.name)}, contentType=${
      initialize.contentType
    }`;
  } else {
    initDetail = `status=${initialize.status}, parse_error=invalid JSON/SSE JSON`;
  }
  results.push(result("MCP initialize", initOk, initDetail));

  const toolsList = await callRpc(baseUrl, "tools/list", {}, 2, defaultHeaders);
  const toolNames = namesFromList(toolsList.parsed, "tools");
  results.push(
    result(
      "MCP tools/list",
      toolsList.status === 200 &&
        ["get_weather_1km", "search_farmland", "open_dashboard"].every((name) =>
          toolNames.includes(name),
        ),
      `status=${toolsList.status}, count=${toolNames.length}, sample=${toolNames
        .slice(0, 8)
        .join(",")}`,
    ),
  );

  const promptsList = await callRpc(baseUrl, "prompts/list", {}, 3, defaultHeaders);
  const promptNames = namesFromList(promptsList.parsed, "prompts");
  results.push(
    result(
      "MCP prompts/list",
      promptsList.status === 200 &&
        ["field_summary", "pesticide_advice", "staff_deploy_plan"].every((name) =>
          promptNames.includes(name),
        ),
      `status=${promptsList.status}, count=${promptNames.length}, sample=${promptNames
        .slice(0, 8)
        .join(",")}`,
    ),
  );

  const resourcesList = await callRpc(baseUrl, "resources/list", {}, 4, defaultHeaders);
  const resourceUris = namesFromList(resourcesList.parsed, "resources");
  results.push(
    result(
      "MCP resources/list",
      resourcesList.status === 200 && resourceUris.includes("ui://agriops/dashboard.html"),
      `status=${resourcesList.status}, count=${resourceUris.length}, sample=${resourceUris
        .slice(0, 8)
        .join(",")}`,
    ),
  );

  if (options.metricsBearer) {
    const metrics = await fetchText(`${baseUrl}/metrics`, {
      headers: { authorization: `Bearer ${options.metricsBearer}` },
    });
    results.push(
      result(
        "/metrics",
        metrics.status === 200 && metrics.text.includes("mcp_requests_total"),
        `status=${metrics.status}, bytes=${metrics.text.length}`,
      ),
    );
  }

  console.log(`AgriOps MCP deploy smoke: ${baseUrl}`);
  let failed = 0;
  for (const item of results) {
    const marker = item.ok ? "PASS" : "FAIL";
    console.log(`\n[${marker}] ${item.name}`);
    console.log(item.detail);
    if (!item.ok) failed++;
  }
  if (failed > 0) {
    console.error(`\n${failed} smoke check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll deploy smoke checks passed.");
}

await main();
