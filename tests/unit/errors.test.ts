import { describe, expect, it } from "vitest";
import {
  AuthError,
  NotFoundError,
  RateLimitError,
  UpstreamError,
  ValidationError,
  safeErrorMessage,
} from "../../src/lib/errors.js";

describe("safeErrorMessage", () => {
  it("formats validation errors as user-facing prose", () => {
    expect(safeErrorMessage(new ValidationError("lat out of range"))).toMatch(
      /Invalid input: lat out of range/,
    );
  });

  it("preserves not-found target ids", () => {
    expect(safeErrorMessage(new NotFoundError("field", "K46-0001"))).toMatch(
      /field not found: K46-0001/,
    );
  });

  it("does not leak upstream details", () => {
    const err = new UpstreamError(
      "open-meteo",
      "GET https://api.open-meteo.com/v1/forecast?lat=...",
    );
    const msg = safeErrorMessage(err);
    expect(msg).not.toContain("api.open-meteo.com");
    expect(msg).not.toContain("https://");
    expect(msg).toMatch(/temporarily unavailable/);
  });

  it("does not leak DB or stack details for unknown errors", () => {
    const err = new Error("ECONNRESET\n at /home/secret/path/x.js:1");
    const msg = safeErrorMessage(err);
    expect(msg).not.toContain("ECONNRESET");
    expect(msg).not.toContain("/home/");
  });

  it("formats auth errors", () => {
    expect(safeErrorMessage(new AuthError())).toMatch(/Authorization is required/);
  });

  it("formats rate-limit errors with retry hint when available", () => {
    expect(safeErrorMessage(new RateLimitError(30))).toMatch(/Try again in/);
    expect(safeErrorMessage(new RateLimitError())).toMatch(/Rate limit reached/);
  });
});
