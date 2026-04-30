import type { Request, Response } from "express";

/**
 * Zero-dependency Prometheus exposition. We deliberately avoid
 * `prom-client` for three reasons:
 *
 *   1. Keeps the npm tarball small (matters for serverless cold-start).
 *   2. The MCP server only needs a handful of counters + histograms;
 *      a full Prom registry is overkill.
 *   3. Operators in Cloud Run usually scrape via the OpenTelemetry
 *      collector or Google Managed Prometheus, both of which speak the
 *      text exposition format directly.
 *
 * If you need the full feature set later, swap `Metrics` for
 * `prom-client` behind the same interface — the server only uses
 * `inc`, `observe`, and `expose`.
 */

const HISTOGRAM_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000];

interface CounterEntry {
  type: "counter";
  help: string;
  /** Map of label-string → value. */
  values: Map<string, number>;
}

interface HistogramEntry {
  type: "histogram";
  help: string;
  buckets: number[];
  /** counts per bucket per label-set */
  values: Map<
    string,
    {
      counts: number[];
      sum: number;
      count: number;
    }
  >;
}

type MetricEntry = CounterEntry | HistogramEntry;

export interface Metrics {
  inc(name: string, labels?: Record<string, string>, value?: number): void;
  observe(name: string, value: number, labels?: Record<string, string>): void;
  expose(): string;
  middleware: (req: Request, res: Response) => void;
}

export interface MetricsOptions {
  /** Bearer token gating /metrics; if unset, the endpoint is public (matches Prom default). */
  bearerToken?: string;
  /** Constant labels appended to every series (e.g. service, version). */
  defaultLabels?: Record<string, string>;
}

export function createMetrics(options: MetricsOptions = {}): Metrics {
  const registry = new Map<string, MetricEntry>();
  const defaults = options.defaultLabels ?? {};
  const bearer = options.bearerToken;

  ensureCounter("mcp_requests_total", "Total /mcp requests received (after host header check).");
  ensureCounter("rate_limited_total", "Total rate-limited /mcp requests.");
  ensureCounter("tool_calls_total", "Total MCP tool calls (labels: tool, outcome).");
  ensureHistogram(
    "tool_duration_ms",
    "Tool call duration in ms (labels: tool).",
    HISTOGRAM_BUCKETS_MS,
  );
  ensureHistogram(
    "http_request_duration_ms",
    "HTTP request duration in ms (labels: route, status).",
    HISTOGRAM_BUCKETS_MS,
  );

  function ensureCounter(name: string, help: string): CounterEntry {
    const existing = registry.get(name);
    if (existing && existing.type === "counter") return existing;
    const entry: CounterEntry = { type: "counter", help, values: new Map() };
    registry.set(name, entry);
    return entry;
  }

  function ensureHistogram(name: string, help: string, buckets: number[]): HistogramEntry {
    const existing = registry.get(name);
    if (existing && existing.type === "histogram") return existing;
    const entry: HistogramEntry = {
      type: "histogram",
      help,
      buckets: [...buckets],
      values: new Map(),
    };
    registry.set(name, entry);
    return entry;
  }

  function labelKey(labels?: Record<string, string>): string {
    const merged = { ...defaults, ...(labels ?? {}) };
    const keys = Object.keys(merged).sort();
    if (keys.length === 0) return "";
    return keys.map((k) => `${k}=${escapeLabel(merged[k] ?? "")}`).join(",");
  }

  function escapeLabel(v: string): string {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }

  return {
    inc(name, labels, value = 1): void {
      const entry = ensureCounter(name, registry.get(name)?.help ?? name);
      const key = labelKey(labels);
      entry.values.set(key, (entry.values.get(key) ?? 0) + value);
    },
    observe(name, value, labels): void {
      const entry = ensureHistogram(name, registry.get(name)?.help ?? name, HISTOGRAM_BUCKETS_MS);
      const key = labelKey(labels);
      let bucket = entry.values.get(key);
      if (!bucket) {
        bucket = { counts: new Array(entry.buckets.length).fill(0), sum: 0, count: 0 };
        entry.values.set(key, bucket);
      }
      bucket.sum += value;
      bucket.count += 1;
      for (let i = 0; i < entry.buckets.length; i++) {
        if (value <= (entry.buckets[i] ?? Number.POSITIVE_INFINITY)) {
          bucket.counts[i] = (bucket.counts[i] ?? 0) + 1;
        }
      }
    },
    expose(): string {
      const lines: string[] = [];
      for (const [name, entry] of registry) {
        lines.push(`# HELP ${name} ${entry.help}`);
        lines.push(`# TYPE ${name} ${entry.type}`);
        if (entry.type === "counter") {
          for (const [key, v] of entry.values) {
            lines.push(`${name}${formatLabels(key)} ${v}`);
          }
          if (entry.values.size === 0) {
            lines.push(`${name}${formatLabels(labelKey())} 0`);
          }
        } else {
          for (const [key, hv] of entry.values) {
            for (let i = 0; i < entry.buckets.length; i++) {
              const le = entry.buckets[i];
              if (le === undefined) continue;
              const count = hv.counts[i] ?? 0;
              lines.push(`${name}_bucket${formatLabels(key, { le: String(le) })} ${count}`);
            }
            lines.push(`${name}_bucket${formatLabels(key, { le: "+Inf" })} ${hv.count}`);
            lines.push(`${name}_sum${formatLabels(key)} ${hv.sum}`);
            lines.push(`${name}_count${formatLabels(key)} ${hv.count}`);
          }
        }
      }
      return `${lines.join("\n")}\n`;
    },
    middleware(req, res): void {
      if (bearer) {
        const auth = req.headers.authorization ?? "";
        if (auth !== `Bearer ${bearer}`) {
          res.status(401).type("text/plain").send("unauthorized\n");
          return;
        }
      }
      res.setHeader("content-type", "text/plain; version=0.0.4");
      res.send(this.expose());
    },
  };
}

function formatLabels(key: string, extra?: Record<string, string>): string {
  const parts: string[] = [];
  if (key) parts.push(key);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      parts.push(`${k}="${v}"`);
    }
  }
  if (parts.length === 0) return "";
  return `{${parts.join(",")}}`;
}
