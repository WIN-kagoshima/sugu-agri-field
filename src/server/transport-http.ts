import type { Server } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import cookieParser from "cookie-parser";
import express from "express";
import { FileTokenStore } from "../auth/file-token-store.js";
import { InMemoryTokenStore, type TokenStore } from "../auth/token-store.js";
import { InMemoryElicitationStore } from "../elicitation/store.js";
import type { Config } from "../lib/config.js";
import type { Logger } from "../lib/logger.js";
import { mountConnectHandler } from "./connect-handler.js";
import { createServer } from "./create-server.js";
import { Lifecycle } from "./lifecycle.js";
import { type Metrics, createMetrics } from "./metrics.js";
import { createRateLimiter } from "./rate-limit.js";
import { getRequestId, requestIdMiddleware } from "./request-id.js";
import { mountWellKnown } from "./well-known.js";

export interface HttpServerOptions {
  config: Config;
  logger: Logger;
  version: string;
  /** Override for tests; omit in production. */
  metricsBearer?: string;
}

export interface HttpServerHandle {
  /** Close the listening socket and drain inflight requests. */
  stop: () => Promise<void>;
  /** True after `stop()` has been called. */
  isStopped: () => boolean;
  /** Useful for tests. */
  port: number;
}

function buildAllowedHosts(config: Config): string[] {
  const hosts = new Set<string>(["localhost", "127.0.0.1", "[::1]", "::1"]);
  for (const h of ["localhost", "127.0.0.1"]) {
    hosts.add(`${h}:${config.port}`);
  }
  try {
    const u = new URL(config.baseUrl);
    hosts.add(u.host);
    hosts.add(u.hostname);
  } catch {
    // Ignore malformed baseUrl; loopback fallbacks remain.
  }
  return Array.from(hosts);
}

/**
 * Streamable HTTP transport in **stateless** mode with the production
 * sidecars: graceful shutdown, per-IP rate limiting, Prometheus
 * metrics, and an adapter-aware readiness probe.
 *
 * We follow the official `simpleStatelessStreamableHttp.ts` pattern
 * (fresh `McpServer` + `StreamableHTTPServerTransport` per request)
 * because Cloud Run scale-to-zero makes server-side session state
 * unsafe.
 */
export async function startHttp(
  _initialServer: McpServer,
  options: HttpServerOptions,
): Promise<HttpServerHandle> {
  const { config, logger, version } = options;

  const lifecycle = new Lifecycle({ logger });
  const metrics = createMetrics({
    bearerToken: options.metricsBearer ?? env("AGRIOPS_METRICS_BEARER", "SUGU_METRICS_BEARER"),
    defaultLabels: { service: "agriops-mcp", version },
  });
  const rateLimiter = createRateLimiter({
    refillPerSec: numEnv("AGRIOPS_RATE_RPS", 10, "SUGU_RATE_RPS"),
    burst: numEnv("AGRIOPS_RATE_BURST", 30, "SUGU_RATE_BURST"),
    logger,
    metrics,
  });

  const app = express();
  app.disable("x-powered-by");
  // Trust the first reverse-proxy hop. On Cloud Run that's GFE; on
  // self-hosted setups operators set this via AGRIOPS_TRUST_PROXY.
  app.set("trust proxy", numEnv("AGRIOPS_TRUST_PROXY", 1, "SUGU_TRUST_PROXY"));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser(config.sessionCookieSecret));
  app.use(requestIdMiddleware);

  // ----- Health & metadata -----
  const healthHandler: express.RequestHandler = (_req, res) => {
    if (!lifecycle.isHealthy()) {
      res.status(503).json({ status: "draining", state: lifecycle.getState() });
      return;
    }
    res.json({ status: "ok", version, name: "agriops-mcp" });
  };
  app.get("/healthz", healthHandler);
  app.get("/livez", healthHandler);

  app.get("/readyz", async (_req, res) => {
    if (!lifecycle.isHealthy()) {
      res.status(503).json({ status: "draining" });
      return;
    }
    const checks = await runReadinessChecks({ config, logger, version });
    const ok = checks.every((c) => c.ok);
    res.status(ok ? 200 : 503).json({
      status: ok ? "ready" : "not_ready",
      checks,
      inflight: lifecycle.inflightCount(),
    });
  });

  app.get("/metrics", (req, res) => metrics.middleware(req, res));

  // Process-singleton stores shared between per-request McpServer
  // instances and the /connect handler. URL-mode elicitation flows have
  // to be picked up by the same backend that issued them, even when
  // requests land on different McpServer instances.
  const elicitationStore = new InMemoryElicitationStore();
  const tokenStore = chooseTokenStore(logger);

  // Build a temporary server once at startup so the Server Card reflects
  // the same conditional surface every per-request server will register.
  const probe = createServer({
    config,
    logger,
    version,
    overrides: { elicitationStore, tokenStore },
  });
  mountWellKnown(app, { baseUrl: config.baseUrl, version, surface: probe.surface });
  void probe.server.close();
  mountConnectHandler(app, { ...options, elicitationStore, tokenStore });

  const allowedHosts = buildAllowedHosts(config);

  // ----- Streamable HTTP MCP endpoint -----
  // Order matters: lifecycle 503s come before rate-limit 429s, both
  // come before host-allowlist 421s, all come before any handler runs.
  app.all("/mcp", lifecycle.middleware, rateLimiter.middleware, async (req, res) => {
    const requestId = getRequestId(res);
    const reqLogger = logger.child({ requestId });
    const startedAt = Date.now();
    metrics.inc("mcp_requests_total");

    if (!isAllowedHost(req.headers.host, allowedHosts)) {
      reqLogger.warn("rejected request: host not allowed", { host: req.headers.host });
      res.status(421).json({
        jsonrpc: "2.0",
        error: {
          code: -32600,
          message: "Misdirected request: host not allowed.",
          data: { requestId },
        },
        id: null,
      });
      metrics.observe("http_request_duration_ms", Date.now() - startedAt, {
        route: "/mcp",
        status: "421",
      });
      return;
    }

    const { server: requestServer } = createServer({
      config,
      logger: reqLogger,
      version,
      overrides: { elicitationStore, tokenStore },
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableDnsRebindingProtection: true,
      allowedHosts,
    });

    res.on("close", () => {
      transport.close().catch((err: unknown) => {
        reqLogger.warn("transport close failed", { error: (err as Error).message });
      });
      requestServer.close().catch((err: unknown) => {
        reqLogger.warn("server close failed", { error: (err as Error).message });
      });
      metrics.observe("http_request_duration_ms", Date.now() - startedAt, {
        route: "/mcp",
        status: String(res.statusCode),
      });
    });

    try {
      await requestServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      reqLogger.error("MCP request failed", { error: (err as Error).message });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error.",
            data: { requestId },
          },
          id: null,
        });
      }
    }
  });

  const httpServer: Server = await new Promise<Server>((resolveListen) => {
    const s = app.listen(config.port, () => {
      logger.info("Streamable HTTP transport listening", {
        port: config.port,
        baseUrl: config.baseUrl,
      });
      resolveListen(s);
    });
  });
  // Disable Node's default keep-alive behaviour during shutdown so
  // sockets don't hold the process alive past the drain window.
  httpServer.headersTimeout = 30_000;
  httpServer.keepAliveTimeout = 5_000;

  let stopped = false;
  return {
    isStopped: () => stopped,
    port: config.port,
    async stop() {
      if (stopped) return;
      stopped = true;
      logger.info("HTTP shutdown initiated");
      const drainResult = await lifecycle.drain();
      if (drainResult.timedOut) {
        logger.warn("drain timed out; forcing close", drainResult);
      } else {
        logger.info("drain finished", drainResult);
      }
      await new Promise<void>((resolveClose) => {
        httpServer.close(() => resolveClose());
      });
    },
  };
}

async function runReadinessChecks(opts: {
  config: Config;
  logger: Logger;
  version: string;
}): Promise<Array<{ name: string; ok: boolean; reason?: string }>> {
  const out: Array<{ name: string; ok: boolean; reason?: string }> = [];
  // Heavy adapters (better-sqlite3) open files synchronously at
  // construction; we surface their existence via createServer's surface
  // catalogue. We never hit upstream HTTP here — readiness probes are
  // called frequently (every few seconds in some load balancers) and
  // must stay fast and free.
  try {
    const probe = createServer({
      config: opts.config,
      logger: opts.logger,
      version: opts.version,
    });
    out.push({ name: "weather", ok: true });
    out.push({
      name: "jma",
      ok: probe.deps.jma !== null,
      reason: probe.deps.jma ? undefined : "adapter disabled",
    });
    out.push({
      name: "emaff",
      ok: probe.deps.emaff !== null,
      reason: probe.deps.emaff ? undefined : "snapshot missing (Phase 0 mode)",
    });
    out.push({
      name: "famic",
      ok: probe.deps.famic !== null,
      reason: probe.deps.famic ? undefined : "snapshot missing (Phase 0 mode)",
    });
    void probe.server.close();
  } catch (err) {
    out.push({ name: "createServer", ok: false, reason: (err as Error).message });
  }
  return out;
}

function isAllowedHost(host: string | undefined, allowed: string[]): boolean {
  if (!host) return false;
  if (allowed.includes(host)) return true;
  const hostname = host.split(":")[0];
  return Boolean(hostname) && allowed.includes(hostname as string);
}

function chooseTokenStore(logger: Logger): TokenStore {
  const hasKey =
    !!env("AGRIOPS_TOKEN_ENC_KEY", "SUGU_TOKEN_ENC_KEY") ||
    !!env("AGRIOPS_TOKEN_ENC_PASSPHRASE", "SUGU_TOKEN_ENC_PASSPHRASE");
  if (hasKey) {
    try {
      const store = new FileTokenStore({ dir: env("AGRIOPS_TOKEN_DIR", "SUGU_TOKEN_DIR") });
      logger.info("token store backend: encrypted file");
      return store;
    } catch (err) {
      logger.error("failed to initialise FileTokenStore; falling back to in-memory", {
        error: (err as Error).message,
      });
    }
  } else {
    logger.warn(
      "token store backend: in-memory (NOT for production). Set AGRIOPS_TOKEN_ENC_KEY (base64 32B) or AGRIOPS_TOKEN_ENC_PASSPHRASE to enable the encrypted file store.",
    );
  }
  return new InMemoryTokenStore();
}

function env(name: string, legacyName?: string): string | undefined {
  return process.env[name] || (legacyName ? process.env[legacyName] : undefined);
}

function numEnv(name: string, fallback: number, legacyName?: string): number {
  const raw = env(name, legacyName);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// Re-export for tests.
export type { Metrics };
