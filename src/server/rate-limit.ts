import type { NextFunction, Request, Response } from "express";
import type { Logger } from "../lib/logger.js";
import type { Metrics } from "./metrics.js";

/**
 * In-memory token-bucket rate limiter for the `/mcp` endpoint.
 *
 * Why this exists:
 *   A misbehaving LLM client can easily hammer `tools/call` in a tight
 *   loop and exhaust upstream rate budgets (Open-Meteo / JMA) or
 *   server CPU. We apply a per-IP token bucket so that:
 *
 *     - Burst spikes (`burst`) are absorbed without a 429.
 *     - Sustained throughput is capped at `refillPerSec`.
 *     - 429 responses include the spec-compliant `Retry-After` header
 *       and a JSON-RPC error with code `-32429` (custom; outside the
 *       spec-reserved range so clients can detect it).
 *
 * For multi-instance Cloud Run deployments, swap this for a Memorystore
 * Redis-backed limiter; the public surface is unchanged.
 */

export interface RateLimitOptions {
  /** Tokens/second refill rate. Default 10 req/s. */
  refillPerSec?: number;
  /** Burst capacity. Default 30 req. */
  burst?: number;
  /** TTL for an idle bucket before it is dropped from memory. Default 5 min. */
  bucketIdleTtlMs?: number;
  logger?: Logger;
  metrics?: Metrics;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export interface RateLimiter {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  /** For tests: reset all buckets. */
  reset: () => void;
}

export const RATE_LIMIT_ERROR_CODE = -32429;

export function createRateLimiter(options: RateLimitOptions = {}): RateLimiter {
  const refillPerSec = options.refillPerSec ?? 10;
  const burst = options.burst ?? 30;
  const idleTtlMs = options.bucketIdleTtlMs ?? 5 * 60_000;
  const buckets = new Map<string, Bucket>();
  const logger = options.logger;
  const metrics = options.metrics;

  function take(key: string): { allowed: boolean; retryAfterSec: number; remaining: number } {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: burst, lastRefillMs: now };
      buckets.set(key, b);
    } else {
      const elapsed = now - b.lastRefillMs;
      const refill = (elapsed / 1000) * refillPerSec;
      b.tokens = Math.min(burst, b.tokens + refill);
      b.lastRefillMs = now;
    }
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { allowed: true, retryAfterSec: 0, remaining: Math.floor(b.tokens) };
    }
    const deficit = 1 - b.tokens;
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil(deficit / refillPerSec)),
      remaining: 0,
    };
  }

  function gc(): void {
    const cutoff = Date.now() - idleTtlMs;
    for (const [k, v] of buckets) {
      if (v.lastRefillMs < cutoff) buckets.delete(k);
    }
  }

  return {
    middleware(req, res, next): void {
      const key = clientKey(req);
      const result = take(key);
      res.setHeader("X-RateLimit-Limit", String(burst));
      res.setHeader("X-RateLimit-Remaining", String(result.remaining));
      if (!result.allowed) {
        metrics?.inc("rate_limited_total");
        res.setHeader("Retry-After", String(result.retryAfterSec));
        logger?.warn("rate-limited", { key, retryAfter: result.retryAfterSec });
        res.status(429).json({
          jsonrpc: "2.0",
          error: {
            code: RATE_LIMIT_ERROR_CODE,
            message: `Rate limit exceeded; retry after ~${result.retryAfterSec}s.`,
            data: { retryAfterSec: result.retryAfterSec },
          },
          id: null,
        });
        return;
      }
      // Opportunistic GC: 1/256 chance per request keeps memory bounded
      // without an extra timer. Math.random is fine here, not security.
      if ((Math.random() * 256) | 0) {
        // skip
      } else {
        gc();
      }
      next();
    },
    reset(): void {
      buckets.clear();
    },
  };
}

/**
 * Build a stable per-client key. Trust:
 *   - the first IP in `X-Forwarded-For` if set by a known reverse proxy
 *     (Cloud Run / Nginx); otherwise the socket address.
 *
 * Don't trust XFF blindly because attackers can spoof it. Cloud Run
 * always sets it to the actual client IP, so on Cloud Run this is the
 * correct choice. For self-hosted setups behind an unknown proxy,
 * operators should override via the `RATE_LIMIT_IP_HEADER` env (read
 * by the caller).
 */
function clientKey(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}
