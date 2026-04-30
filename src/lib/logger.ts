/**
 * Tiny structured logger that writes JSON Lines to stderr.
 *
 * Why stderr: stdio transport uses stdout for JSON-RPC. Logging to stdout
 * would break the protocol. Streamable HTTP can use stdout too, but stderr
 * stays compatible with both.
 *
 * Never logs secrets or full request bodies.
 */

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
}

export function createLogger(opts: { level?: Level; base?: Record<string, unknown> } = {}): Logger {
  const minLevel = LEVELS[opts.level ?? "info"];
  const base = opts.base ?? {};

  function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
    if (LEVELS[level] < minLevel) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level,
      msg,
      ...base,
      ...fields,
    });
    process.stderr.write(`${line}\n`);
  }

  return {
    debug: (msg, f) => emit("debug", msg, f),
    info: (msg, f) => emit("info", msg, f),
    warn: (msg, f) => emit("warn", msg, f),
    error: (msg, f) => emit("error", msg, f),
    child: (f) => createLogger({ level: opts.level, base: { ...base, ...f } }),
  };
}
