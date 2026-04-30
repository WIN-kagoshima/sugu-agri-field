import { describe, expect, it } from "vitest";
import { InMemoryElicitationStore } from "../../src/elicitation/store.js";
import {
  URLElicitationRequiredError,
  URL_ELICITATION_ERROR_CODE,
  assertSameUser,
  beginUrlElicitation,
} from "../../src/elicitation/url.js";
import { AuthError } from "../../src/lib/errors.js";

describe("URL-mode elicitation", () => {
  it("uses the reserved JSON-RPC error code -32042", async () => {
    const store = new InMemoryElicitationStore();
    const err = await beginUrlElicitation({
      store,
      userId: "user-1",
      provider: "demo",
      baseUrl: "https://mcp.example.com",
    });
    expect(err).toBeInstanceOf(URLElicitationRequiredError);
    expect(err.code).toBe(URL_ELICITATION_ERROR_CODE);
    expect(err.code).toBe(-32042);
  });

  it("redirect URL points at our /connect/{provider} and not at the upstream provider", async () => {
    const store = new InMemoryElicitationStore();
    const err = await beginUrlElicitation({
      store,
      userId: "user-1",
      provider: "demo",
      baseUrl: "https://mcp.example.com",
    });
    expect(err.data.redirectUrl).toMatch(/^https:\/\/mcp\.example\.com\/connect\/demo\?/);
    expect(err.data.redirectUrl).toMatch(/elicitationId=/);
    // Must not contain upstream provider tokens or credentials.
    expect(err.data.redirectUrl).not.toMatch(/access_token|client_secret|password/i);
  });

  it("creates a record in the store with the requesting userId", async () => {
    const store = new InMemoryElicitationStore();
    const err = await beginUrlElicitation({
      store,
      userId: "user-77",
      provider: "demo",
      baseUrl: "http://localhost:3001",
    });
    const record = await store.get(err.data.elicitationId);
    expect(record).not.toBeNull();
    expect(record?.userId).toBe("user-77");
    expect(record?.completedAt).toBeNull();
  });

  it("assertSameUser passes for the issuing user", async () => {
    const store = new InMemoryElicitationStore();
    const err = await beginUrlElicitation({
      store,
      userId: "user-1",
      provider: "demo",
      baseUrl: "http://localhost:3001",
    });
    await expect(assertSameUser(store, err.data.elicitationId, "user-1")).resolves.toBeUndefined();
  });

  it("assertSameUser throws AuthError for a different user (anti-phishing)", async () => {
    const store = new InMemoryElicitationStore();
    const err = await beginUrlElicitation({
      store,
      userId: "user-1",
      provider: "demo",
      baseUrl: "http://localhost:3001",
    });
    await expect(assertSameUser(store, err.data.elicitationId, "user-evil")).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("assertSameUser throws AuthError for unknown elicitation IDs", async () => {
    const store = new InMemoryElicitationStore();
    await expect(assertSameUser(store, "does-not-exist", "user-1")).rejects.toBeInstanceOf(
      AuthError,
    );
  });
});
