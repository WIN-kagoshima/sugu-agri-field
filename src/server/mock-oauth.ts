import { randomBytes } from "node:crypto";
import express, { type Express, type Request, type Response } from "express";

/**
 * Mock OAuth 2.1 provider for local development.
 *
 * In production this is replaced by the real provider (WAGRI etc.). The
 * mock exposes:
 *
 *   GET  /__mock-oauth/authorize  → renders an "Allow / Deny" HTML page
 *   POST /__mock-oauth/authorize  → redirects back to redirect_uri with a
 *                                    one-time `code` and the original `state`
 *   POST /__mock-oauth/token      → returns a fake access_token in JSON
 *
 * The mock is mounted only when `DEMO_OAUTH_AUTHORIZE_URL` includes the
 * `__mock-oauth` segment (the default in `.env.example`). Real deployments
 * pointing at production providers will not register these routes.
 */
export function mountMockOAuthProvider(app: Express): void {
  const codeStore = new Map<string, { redirectUri: string; createdAt: number }>();

  app.get("/__mock-oauth/authorize", (req: Request, res: Response) => {
    const state = String(req.query.state ?? "");
    const redirectUri = String(req.query.redirect_uri ?? "");
    if (!state || !redirectUri) {
      res.status(400).send("missing state or redirect_uri");
      return;
    }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Mock OAuth — Authorize</title>
<style>body{font-family:system-ui;padding:2rem;max-width:32rem;margin:0 auto;color:#222}
form{margin-top:1rem}button{padding:0.5rem 1rem;margin-right:0.5rem}</style></head>
<body>
<h1>Mock OAuth provider</h1>
<p>This is a local demo. A real provider would show a sign-in form here.</p>
<form method="POST" action="/__mock-oauth/authorize">
  <input type="hidden" name="state" value="${escapeHtml(state)}" />
  <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
  <button type="submit" name="action" value="allow">Allow</button>
  <button type="submit" name="action" value="deny">Deny</button>
</form>
</body></html>`);
  });

  app.post("/__mock-oauth/authorize", express_urlencoded(), (req: Request, res: Response) => {
    const body = req.body as { state?: string; redirect_uri?: string; action?: string };
    if (!body.state || !body.redirect_uri) {
      res.status(400).send("missing state or redirect_uri");
      return;
    }
    if (body.action === "deny") {
      const url = new URL(body.redirect_uri);
      url.searchParams.set("error", "access_denied");
      url.searchParams.set("state", body.state);
      res.redirect(302, url.toString());
      return;
    }
    const code = randomBytes(16).toString("base64url");
    codeStore.set(code, { redirectUri: body.redirect_uri, createdAt: Date.now() });
    const url = new URL(body.redirect_uri);
    url.searchParams.set("code", code);
    url.searchParams.set("state", body.state);
    res.redirect(302, url.toString());
  });

  app.post("/__mock-oauth/token", express_urlencoded(), (req: Request, res: Response) => {
    const body = req.body as { code?: string; grant_type?: string; redirect_uri?: string };
    if (body.grant_type !== "authorization_code" || !body.code || !body.redirect_uri) {
      res.status(400).json({ error: "invalid_request" });
      return;
    }
    const entry = codeStore.get(body.code);
    if (!entry || entry.redirectUri !== body.redirect_uri) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }
    if (Date.now() - entry.createdAt > 5 * 60 * 1000) {
      codeStore.delete(body.code);
      res.status(400).json({ error: "expired_code" });
      return;
    }
    codeStore.delete(body.code);
    res.json({
      access_token: `mock-${randomBytes(16).toString("base64url")}`,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: `mock-refresh-${randomBytes(16).toString("base64url")}`,
      scope: "read",
    });
  });
}

function express_urlencoded() {
  return express.urlencoded({ extended: false });
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
