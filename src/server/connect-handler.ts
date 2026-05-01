import { randomBytes } from "node:crypto";
import type { Express, Request, Response } from "express";
import { OAuthClient } from "../auth/oauth-client.js";
import type { TokenStore } from "../auth/token-store.js";
import type { ElicitationStore } from "../elicitation/store.js";
import { mountMockOAuthProvider } from "./mock-oauth.js";
import { getRequestId } from "./request-id.js";
import type { HttpServerOptions } from "./transport-http.js";

const SESSION_COOKIE = "agriops_session";

export interface ConnectHandlerOptions extends HttpServerOptions {
  elicitationStore: ElicitationStore;
  tokenStore: TokenStore;
}

/**
 * Phase 4 wiring: `/connect/{provider}` and `/callback/{provider}`.
 *
 * Flow:
 *   1. A tool throws `URLElicitationRequiredError` whose data.redirectUrl
 *      points at `${baseUrl}/connect/{provider}?elicitationId=…`.
 *   2. The user opens it in their browser. We MUST verify the session cookie
 *      matches the user the elicitation was issued for (anti-phishing).
 *   3. We redirect to the provider's authorize_url with a fresh `state`
 *      that we keep in a server-side map (no secrets in URL).
 *   4. Provider redirects back to `/callback/{provider}?code=…&state=…`.
 *      We exchange the code for a token, persist it in `TokenStore`, mark
 *      the elicitation complete, and tell the MCP client via
 *      `notifications/elicitation/complete`.
 */
export function mountConnectHandler(app: Express, options: ConnectHandlerOptions): void {
  // For the OSS demo we always mount the mock provider so the flow is
  // exercisable end-to-end without external accounts.
  mountMockOAuthProvider(app);

  const stateStore = new Map<
    string,
    { provider: string; elicitationId: string; userId: string; createdAt: number }
  >();

  app.get("/connect/:provider", async (req: Request, res: Response) => {
    const provider = String(req.params.provider ?? "");
    const elicitationId = String(req.query.elicitationId ?? "");
    if (!provider) {
      res.status(400).json({ error: "missing_provider" });
      return;
    }
    if (!elicitationId) {
      res.status(400).json({ error: "missing_elicitation_id" });
      return;
    }
    if (!options.config.demoOAuth) {
      res.status(501).json({ error: "oauth_not_configured" });
      return;
    }

    const userId = readOrIssueUserId(req, res, options.config.sessionCookieSecret);

    // Anti-phishing check (Spec 2025-11-25 elicitation/url): the user
    // browsing to this link MUST be the same one whose MCP session
    // generated the elicitation. We look up the elicitation record and
    // compare the cookie-issued userId against the stored one.
    const record = await options.elicitationStore.get(elicitationId);
    if (!record) {
      res.status(404).json({
        error: "not_found",
        message: "This authorization link has expired or was never issued.",
      });
      return;
    }
    if (record.userId !== userId) {
      res.status(403).json({
        error: "forbidden",
        message:
          "This authorization link belongs to another user. Re-issue the elicitation from the same client session.",
      });
      return;
    }

    const state = randomBytes(24).toString("base64url");
    stateStore.set(state, {
      provider,
      elicitationId,
      userId,
      createdAt: Date.now(),
    });

    const oauth = new OAuthClient({
      clientId: options.config.demoOAuth.clientId,
      clientSecret: options.config.demoOAuth.clientSecret,
      authorizeUrl: options.config.demoOAuth.authorizeUrl,
      tokenUrl: options.config.demoOAuth.tokenUrl,
    });
    const redirectUri = new URL(
      `/callback/${encodeURIComponent(provider)}`,
      options.config.baseUrl,
    ).toString();
    const url = oauth.buildAuthorizeUrl({ state, redirectUri, scope: "read" });
    res.redirect(302, url);
  });

  app.get("/callback/:provider", async (req: Request, res: Response) => {
    const provider = String(req.params.provider ?? "");
    const code = String(req.query.code ?? "");
    if (!provider) {
      res.status(400).json({ error: "missing_provider" });
      return;
    }
    const state = String(req.query.state ?? "");
    const error = req.query.error;
    if (error) {
      res.status(400).json({ error: "authorization_denied", detail: error });
      return;
    }
    if (!code || !state) {
      res.status(400).json({ error: "missing_parameters" });
      return;
    }
    const entry = stateStore.get(state);
    if (!entry || entry.provider !== provider) {
      res.status(400).json({ error: "invalid_state" });
      return;
    }
    stateStore.delete(state);

    if (!options.config.demoOAuth) {
      res.status(501).json({ error: "oauth_not_configured" });
      return;
    }

    const oauth = new OAuthClient({
      clientId: options.config.demoOAuth.clientId,
      clientSecret: options.config.demoOAuth.clientSecret,
      authorizeUrl: options.config.demoOAuth.authorizeUrl,
      tokenUrl: options.config.demoOAuth.tokenUrl,
    });
    const redirectUri = new URL(
      `/callback/${encodeURIComponent(provider)}`,
      options.config.baseUrl,
    ).toString();
    try {
      const token = await oauth.exchangeCode({ code, redirectUri });
      await options.tokenStore.save(entry.userId, provider, {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        expiresAt: Date.now() + (token.expires_in ?? 3600) * 1000,
        scope: token.scope ?? null,
      });
      await options.elicitationStore.markComplete(entry.elicitationId);

      // Best-effort completion notification through the active MCP session
      // would happen here; the SDK exposes
      // `server.server.sendElicitationComplete()` in newer builds. We log
      // for now so the client knows the side-channel completed.
      options.logger.child({ requestId: getRequestId(res) }).info("elicitation completed", {
        provider,
        elicitationId: entry.elicitationId,
        userId: entry.userId,
      });

      res.setHeader("content-type", "text/html; charset=utf-8");
      res.send(completionHtml(provider));
    } catch (err) {
      options.logger
        .child({ requestId: getRequestId(res) })
        .error("OAuth callback failed", { error: (err as Error).message });
      res.status(502).json({ error: "token_exchange_failed" });
    }
  });
}

function readOrIssueUserId(req: Request, res: Response, _secret: string): string {
  const cookies = (req as Request & { signedCookies?: Record<string, string> }).signedCookies;
  const existing = cookies?.[SESSION_COOKIE];
  if (existing) return existing;
  const id = randomBytes(16).toString("base64url");
  res.cookie(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    signed: true,
    secure: false, // operators set true via reverse proxy in production
    maxAge: 24 * 60 * 60 * 1000,
  });
  return id;
}

function completionHtml(provider: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Authorized</title>
<style>body{font-family:system-ui;padding:2rem;max-width:32rem;margin:0 auto;color:#222}</style></head>
<body>
<h1>Authorized ✓</h1>
<p>The connection to <strong>${escapeHtml(provider)}</strong> is complete. You can close this tab; the agent will continue automatically.</p>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return ch;
    }
  });
}
