import type { AddressInfo } from "node:net";
import cookieParser from "cookie-parser";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InMemoryTokenStore, type TokenStore } from "../../src/auth/token-store.js";
import {
  type ElicitationRecord,
  type ElicitationStore,
  InMemoryElicitationStore,
} from "../../src/elicitation/store.js";
import type { Config } from "../../src/lib/config.js";
import { createLogger } from "../../src/lib/logger.js";
import { mountConnectHandler } from "../../src/server/connect-handler.js";

/**
 * Phase 4 OAuth URL elicitation, end-to-end.
 *
 * We mount the *real* `mountConnectHandler` against an Express app on a
 * loopback port, seed an `ElicitationRecord` for a known userId, and
 * walk the full flow: GET /connect/{provider} → 302 → mock authorize →
 * POST allow → 302 callback → token exchange → token store populated.
 *
 * Tracking the session cookie across redirects is the whole point of
 * the test: it is the anti-phishing check the spec requires.
 */
describe("Phase 4 OAuth URL elicitation flow", () => {
  let baseUrl: string;
  let elicitationStore: ElicitationStore;
  let tokenStore: TokenStore;
  let httpServer: ReturnType<ReturnType<typeof express>["listen"]>;

  beforeAll(async () => {
    const app = express();
    app.use(cookieParser("test-cookie-secret-very-long-not-real"));

    elicitationStore = new InMemoryElicitationStore();
    tokenStore = new InMemoryTokenStore();
    const logger = createLogger({ level: "warn" });

    httpServer = await new Promise<ReturnType<ReturnType<typeof express>["listen"]>>(
      (resolveListen) => {
        const handle = app.listen(0, () => resolveListen(handle));
      },
    );
    const port = (httpServer.address() as AddressInfo).port;
    baseUrl = `http://localhost:${port}`;

    const config: Config = {
      port,
      logLevel: "warn",
      baseUrl,
      openMeteoBaseUrl: "https://api.open-meteo.com/v1",
      emaffSnapshotPath: "./snapshots/none.sqlite",
      famicSnapshotPath: "./snapshots/none.sqlite",
      sessionCookieSecret: "test-cookie-secret-very-long-not-real",
      demoOAuth: {
        clientId: "demo-client",
        clientSecret: "demo-secret",
        authorizeUrl: `${baseUrl}/__mock-oauth/authorize`,
        tokenUrl: `${baseUrl}/__mock-oauth/token`,
      },
    };

    mountConnectHandler(app, {
      config,
      logger,
      version: "0.5.0-oauth-test",
      elicitationStore,
      tokenStore,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolveClose()));
    });
  });

  /**
   * Walks the full happy path. We use manual fetch + Set-Cookie tracking
   * because Node's `fetch` does not have a built-in cookie jar.
   */
  it("issues an access token only after same-user verification, then completes the elicitation", async () => {
    const elicitationId = "elicit-test-1";

    // Step 1: connect the very first time. The server has not seen us
    // before, so no elicitation record exists with our (yet-to-be-issued)
    // userId. Instead of guessing the user, we let the server set a
    // session cookie on our first request and read it from Set-Cookie.
    const probeRes = await fetch(`${baseUrl}/connect/demo?elicitationId=bootstrap`, {
      redirect: "manual",
    });
    expect([403, 404]).toContain(probeRes.status); // No record yet — both are fine.
    const cookieHeader = probeRes.headers.get("set-cookie");
    expect(cookieHeader, "server should set the session cookie even on rejection").toBeTruthy();
    const cookieJar = parseSetCookie(cookieHeader as string);

    // Step 2: extract the userId the server assigned us. The cookie is
    // signed but we only need the value to compare with the elicitation
    // record. The cookie-parser `signed` form is `s:<value>.<sig>`.
    const sessionCookie = cookieJar.sugu_session;
    expect(sessionCookie, "session cookie present").toBeTruthy();
    const userId = decodeSignedCookieValue(sessionCookie as string);
    expect(userId.length).toBeGreaterThan(8);

    // Step 3: seed the elicitation for this user.
    const record: ElicitationRecord = {
      id: elicitationId,
      userId,
      provider: "demo",
      expiresAt: Date.now() + 5 * 60_000,
      completedAt: null,
    };
    await elicitationStore.create(record);

    // Step 4: GET /connect/demo with the session cookie → expect 302 to
    // the mock authorize endpoint with a `state` we can capture.
    const authRes = await fetch(
      `${baseUrl}/connect/demo?elicitationId=${encodeURIComponent(elicitationId)}`,
      {
        redirect: "manual",
        headers: { cookie: serializeCookies(cookieJar) },
      },
    );
    expect(authRes.status).toBe(302);
    const authorizeUrl = new URL(authRes.headers.get("location") as string);
    expect(authorizeUrl.pathname).toBe("/__mock-oauth/authorize");
    const state = authorizeUrl.searchParams.get("state");
    const redirectUri = authorizeUrl.searchParams.get("redirect_uri");
    expect(state).toBeTruthy();
    expect(redirectUri).toBeTruthy();

    // Step 5: simulate the user clicking "Allow" on the mock authorize page.
    const allowRes = await fetch(`${baseUrl}/__mock-oauth/authorize`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        state: state as string,
        redirect_uri: redirectUri as string,
        action: "allow",
      }).toString(),
    });
    expect(allowRes.status).toBe(302);
    const callbackUrl = new URL(allowRes.headers.get("location") as string);
    expect(callbackUrl.pathname).toBe("/callback/demo");
    expect(callbackUrl.searchParams.get("code")).toBeTruthy();

    // Step 6: hit /callback with the cookie → token exchange runs server-side.
    const callbackRes = await fetch(callbackUrl.toString(), {
      redirect: "manual",
      headers: { cookie: serializeCookies(cookieJar) },
    });
    expect(callbackRes.status).toBe(200);
    const html = await callbackRes.text();
    expect(html).toMatch(/Authorized/);

    // Step 7: verify side-effects.
    const tokenRecord = await tokenStore.get(userId, "demo");
    expect(tokenRecord, "token persisted").toBeTruthy();
    expect(tokenRecord?.accessToken).toMatch(/^mock-/);

    const elicitationAfter = await elicitationStore.get(elicitationId);
    expect(elicitationAfter?.completedAt, "elicitation marked complete").toBeTruthy();
  }, 30_000);

  it("rejects /connect when the elicitation belongs to a different user (anti-phishing)", async () => {
    const elicitationId = "elicit-other-user";
    await elicitationStore.create({
      id: elicitationId,
      userId: "completely-different-user-id",
      provider: "demo",
      expiresAt: Date.now() + 60_000,
      completedAt: null,
    });

    const res = await fetch(
      `${baseUrl}/connect/demo?elicitationId=${encodeURIComponent(elicitationId)}`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string; message?: string };
    expect(body.error).toBe("forbidden");
    expect(body.message).toMatch(/another user/i);
  }, 15_000);
});

function parseSetCookie(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(/,\s*(?=[^=;]+=)/)) {
    const [pair] = part.split(";");
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    out[name] = value;
  }
  return out;
}

function serializeCookies(jar: Record<string, string>): string {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/**
 * `cookie-parser` signed cookies are encoded as `s:<value>.<sig>`. The
 * URL-encoded form arrives as `s%3A<value>.<sig>`.
 */
function decodeSignedCookieValue(raw: string): string {
  const decoded = decodeURIComponent(raw);
  if (!decoded.startsWith("s:")) return decoded;
  const dot = decoded.lastIndexOf(".");
  if (dot < 0) return decoded.slice(2);
  return decoded.slice(2, dot);
}
