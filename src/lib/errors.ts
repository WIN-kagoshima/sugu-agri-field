/**
 * Typed error hierarchy used across adapters and tools.
 *
 * Tools must NOT include any of these messages verbatim in client output.
 * The registry layer maps these to safe text.
 */

export class SuguAgriFieldError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown> | undefined;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SuguAgriFieldError";
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends SuguAgriFieldError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("validation_error", message, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends SuguAgriFieldError {
  constructor(resource: string, id: string) {
    super("not_found", `${resource} not found: ${id}`, { resource, id });
    this.name = "NotFoundError";
  }
}

export class UpstreamError extends SuguAgriFieldError {
  public readonly upstream: string;
  constructor(upstream: string, message: string, details?: Record<string, unknown>) {
    super("upstream_error", message, details);
    this.name = "UpstreamError";
    this.upstream = upstream;
  }
}

export class AuthError extends SuguAgriFieldError {
  constructor(message = "authorization required") {
    super("unauthorized", message);
    this.name = "AuthError";
  }
}

export class RateLimitError extends SuguAgriFieldError {
  public readonly retryAfterSec: number | undefined;
  constructor(retryAfterSec?: number) {
    super("rate_limited", "rate limit exceeded");
    this.name = "RateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

/**
 * Map a known error to a safe, user-facing string.
 * Never includes URLs, stack frames, or upstream payloads.
 */
export function safeErrorMessage(err: unknown): string {
  if (err instanceof ValidationError) {
    return `Invalid input: ${err.message}`;
  }
  if (err instanceof NotFoundError) {
    return err.message;
  }
  if (err instanceof AuthError) {
    return "Authorization is required for this operation.";
  }
  if (err instanceof RateLimitError) {
    return err.retryAfterSec
      ? `Rate limit reached. Try again in ~${err.retryAfterSec}s.`
      : "Rate limit reached. Please try again shortly.";
  }
  if (err instanceof UpstreamError) {
    return `Upstream data source temporarily unavailable (${err.upstream}). Please retry later.`;
  }
  if (err instanceof SuguAgriFieldError) {
    return err.message;
  }
  return "Internal error. Please retry, and report the request ID if it persists.";
}
