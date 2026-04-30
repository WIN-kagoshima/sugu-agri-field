import { randomUUID } from "node:crypto";
import { AuthError } from "../lib/errors.js";
import type { ElicitationStore } from "./store.js";

/**
 * JSON-RPC error code reserved by the MCP elicitation extension for
 * URL-mode elicitation. The server throws this from inside a tool handler
 * to signal "I need the user to complete an external authorization flow
 * before I can answer." The client opens the `redirectUrl` in a browser
 * and waits for `notifications/elicitation/complete`.
 *
 * See: https://github.com/modelcontextprotocol/specification (URL elicitation
 * draft) and `mcp-builder/references/security-auth.md`.
 */
export const URL_ELICITATION_ERROR_CODE = -32042;

export interface UrlElicitationRequest {
  /** Stable identifier across `notifications/elicitation/complete`. */
  elicitationId: string;
  /** Where the *user* should be sent in their browser. */
  redirectUrl: string;
  /** What completion looks like, for the LLM to mention to the user. */
  reason: string;
  /** Optional TTL hint, in seconds. */
  ttlSeconds?: number;
}

export class URLElicitationRequiredError extends Error {
  readonly code = URL_ELICITATION_ERROR_CODE;
  readonly data: UrlElicitationRequest;
  constructor(request: UrlElicitationRequest) {
    super(`url_elicitation_required:${request.elicitationId}`);
    this.name = "URLElicitationRequiredError";
    this.data = request;
  }

  /**
   * Shape this error for the JSON-RPC layer. The SDK's `registerTool`
   * handler can re-throw a SuguAgriFieldError-like object; the registry
   * layer maps it to a JSON-RPC error response with `code = -32042`.
   */
  toJsonRpc(): { code: number; message: string; data: UrlElicitationRequest } {
    return {
      code: this.code,
      message: "URL elicitation required",
      data: this.data,
    };
  }
}

export interface BeginUrlElicitationOptions {
  store: ElicitationStore;
  userId: string;
  provider: string;
  baseUrl: string;
  ttlSeconds?: number;
  reason?: string;
}

/**
 * Create a URL-mode elicitation record and return the `URLElicitationRequiredError`
 * the tool should throw.
 *
 * The redirect URL points at our own `/connect/{provider}` handler, which
 * verifies the same session cookie before sending the user to the upstream
 * authorization endpoint. We **never** put credentials, tokens, or
 * pre-authenticated parameters in the URL — the elicitation ID is the only
 * thing the URL needs to know.
 */
export async function beginUrlElicitation(
  options: BeginUrlElicitationOptions,
): Promise<URLElicitationRequiredError> {
  const id = randomUUID();
  const ttlSeconds = options.ttlSeconds ?? 600;
  await options.store.create({
    id,
    userId: options.userId,
    provider: options.provider,
    expiresAt: Date.now() + ttlSeconds * 1000,
    completedAt: null,
  });
  const url = new URL(`/connect/${encodeURIComponent(options.provider)}`, options.baseUrl);
  url.searchParams.set("elicitationId", id);
  return new URLElicitationRequiredError({
    elicitationId: id,
    redirectUrl: url.toString(),
    reason:
      options.reason ??
      `Authorize ${options.provider} access. The browser will open a sign-in page; once approved the tool resumes automatically.`,
    ttlSeconds,
  });
}

/**
 * Check that the bearer of `userId` is the same identity that triggered
 * the elicitation. This is the official MUST anti-phishing requirement.
 */
export async function assertSameUser(
  store: ElicitationStore,
  elicitationId: string,
  userId: string,
): Promise<void> {
  const record = await store.get(elicitationId);
  if (!record) throw new AuthError("elicitation expired or unknown");
  if (record.userId !== userId) throw new AuthError("elicitation issued for a different user");
}
