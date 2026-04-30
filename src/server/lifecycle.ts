import type { NextFunction, Request, Response } from "express";
import type { Logger } from "../lib/logger.js";

/**
 * Lifecycle / graceful-shutdown manager for the Streamable HTTP transport.
 *
 * Why this exists:
 *   Cloud Run sends SIGTERM ~10 s before SIGKILL during scale-in or
 *   revision swaps. We need to:
 *
 *     1. Stop accepting new requests (for load balancers that observe
 *        readiness, set the readiness probe to false).
 *     2. Let inflight requests finish (`drain`).
 *     3. Close the listening socket and any singletons.
 *     4. Time out at `shutdownTimeoutMs` (slightly less than Cloud Run's
 *        grace window, default 8 s).
 *
 * The state machine: `running` → `draining` → `stopped`. The
 * `drainingMiddleware` rejects requests with `503 Service Unavailable`
 * during `draining`, and the `/healthz` / `/readyz` handlers consult
 * the same flag.
 */

export type LifecycleState = "running" | "draining" | "stopped";

export interface LifecycleOptions {
  logger: Logger;
  /** Total budget for graceful shutdown. Default 8 s (Cloud Run gives 10). */
  shutdownTimeoutMs?: number;
}

export class Lifecycle {
  private state: LifecycleState = "running";
  private inflight = 0;
  private readonly waiters = new Set<() => void>();
  private readonly logger: Logger;
  private readonly shutdownTimeoutMs: number;

  constructor(options: LifecycleOptions) {
    this.logger = options.logger;
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 8_000;
  }

  getState(): LifecycleState {
    return this.state;
  }

  isHealthy(): boolean {
    return this.state === "running";
  }

  inflightCount(): number {
    return this.inflight;
  }

  /** Express middleware: 503 once draining, otherwise tracks the request. */
  middleware = (_req: Request, res: Response, next: NextFunction): void => {
    if (this.state !== "running") {
      res.setHeader("connection", "close");
      res.setHeader("retry-after", "5");
      res.status(503).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Server is draining and not accepting new requests." },
        id: null,
      });
      return;
    }
    this.inflight++;
    res.on("close", () => {
      this.inflight--;
      if (this.inflight === 0) {
        for (const w of this.waiters) w();
      }
    });
    next();
  };

  /**
   * Begin shutdown. Returns when either all inflight requests have
   * finished or the timeout has elapsed. Idempotent.
   */
  async drain(): Promise<{ timedOut: boolean; remaining: number }> {
    if (this.state !== "running") {
      return { timedOut: false, remaining: this.inflight };
    }
    this.state = "draining";
    this.logger.info("draining started", { inflight: this.inflight });

    if (this.inflight === 0) {
      this.state = "stopped";
      return { timedOut: false, remaining: 0 };
    }

    const result = await new Promise<{ timedOut: boolean; remaining: number }>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(notify);
        resolve({ timedOut: true, remaining: this.inflight });
      }, this.shutdownTimeoutMs);

      const notify = (): void => {
        clearTimeout(timer);
        this.waiters.delete(notify);
        resolve({ timedOut: false, remaining: this.inflight });
      };
      this.waiters.add(notify);
    });

    this.state = "stopped";
    return result;
  }
}
